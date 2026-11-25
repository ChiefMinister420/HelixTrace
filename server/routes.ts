import { Router } from 'express';
import type { Response } from 'express';
import { getDb } from './db.ts';
import { authenticateJWT, requireRole } from './auth.ts';
import type { AuthenticatedRequest } from './auth.ts';
import { lookupGeneOnNcbi } from './ncbi.ts';

export const apiRouter = Router();

apiRouter.use(authenticateJWT);

function isPositiveInt(val: unknown): val is number {
  return typeof val === 'number' && Number.isInteger(val) && val > 0;
}

function isValidDateString(val: unknown): val is string {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

// ---------------------------------------------------------------------
// GET /api/dashboard : Experiment summaries, Cas9 fidelity, mismatches
// ---------------------------------------------------------------------
apiRouter.get('/dashboard', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();

    const [totals] = await db.query<{
      samples: number;
      mutations: number;
      high_risk: number;
      alerts: number;
      experiments: number;
      guides: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM sample) AS samples,
        (SELECT COUNT(*) FROM mutation_event) AS mutations,
        (SELECT COUNT(*) FROM v_high_risk_events) AS high_risk,
        (SELECT COUNT(*) FROM alert_log) AS alerts,
        (SELECT COUNT(*) FROM experiment) AS experiments,
        (SELECT COUNT(*) FROM guide_rna) AS guides
    `);

    const experiments = await db.query(`
      SELECT * FROM v_experiment_summary ORDER BY max_freq DESC
    `);

    const fidelityStats = await db.query(`
      SELECT c.fidelity,
             COUNT(e.event_id) AS mutations,
             IFNULL(ROUND(AVG(e.allele_freq), 2), 0) AS avg_freq,
             IFNULL(MAX(e.allele_freq), 0) AS max_freq
      FROM cas_variant c
      LEFT JOIN experiment x ON x.cas_id = c.cas_id
      LEFT JOIN sample s ON s.experiment_id = x.experiment_id
      LEFT JOIN mutation_event e ON e.sample_id = s.sample_id
      GROUP BY c.fidelity
    `);

    const mismatchStats = await db.query(`
      SELECT o.mismatch_count,
             COUNT(e.event_id) AS events,
             IFNULL(ROUND(AVG(e.allele_freq), 2), 0) AS avg_freq,
             IFNULL(MAX(e.allele_freq), 0) AS max_freq
      FROM off_target_site o
      LEFT JOIN mutation_event e ON e.site_id = o.site_id
      GROUP BY o.mismatch_count
      ORDER BY o.mismatch_count
    `);

    const mutationDistribution = await db.query(`
      SELECT mutation_type, COUNT(*) AS cnt, ROUND(AVG(allele_freq), 2) AS avg_freq
      FROM mutation_event
      GROUP BY mutation_type
      ORDER BY cnt DESC
    `);

    const labRisk = await db.query(`
      SELECT l.lab_name, COUNT(*) AS high_risk_events
      FROM v_high_risk_events h
      JOIN experiment x ON x.experiment_id = h.experiment_id
      JOIN researcher r ON r.researcher_id = x.researcher_id
      JOIN lab l ON l.lab_id = r.lab_id
      GROUP BY l.lab_name
      ORDER BY high_risk_events DESC
    `);

    res.json({
      totals,
      experiments,
      fidelityStats,
      mismatchStats,
      mutationDistribution,
      labRisk,
    });
  } catch (err) {
    console.error('[GET /api/dashboard]', err);
    res.status(500).json({ error: 'Failed to load dashboard telemetry.' });
  }
});

// ---------------------------------------------------------------------
// GET /api/lineage : Recursive CTE family tree (Q15 + metadata)
// ---------------------------------------------------------------------
apiRouter.get('/lineage', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const experimentIdParam = req.query.experimentId ? Number(req.query.experimentId) : null;
    const concatExpr =
      db.dialect === 'mysql'
        ? "CONCAT(l.path, ' -> ', s.sample_code)"
        : "l.path || ' -> ' || s.sample_code";
    const castExpr =
      db.dialect === 'mysql' ? 'CAST(sample_code AS CHAR(400))' : 'CAST(sample_code AS TEXT)';

    const baseQuery = `
      WITH RECURSIVE lineage AS (
        SELECT sample_id, sample_code, cell_line, organism_id, experiment_id,
               parent_sample_id, generation, created_date, status, notes,
               ${castExpr} AS path
        FROM sample
        WHERE parent_sample_id IS NULL
        UNION ALL
        SELECT s.sample_id, s.sample_code, s.cell_line, s.organism_id, s.experiment_id,
               s.parent_sample_id, s.generation, s.created_date, s.status, s.notes,
               ${concatExpr} AS path
        FROM sample s
        JOIN lineage l ON s.parent_sample_id = l.sample_id
      )
      SELECT l.*,
             p.sample_code AS parent_sample_code,
             x.title AS experiment_title,
             c.variant_name AS cas_variant,
             c.fidelity AS cas_fidelity,
             o.common_name AS organism_name,
             COUNT(e.event_id) AS mutation_count,
             IFNULL(MAX(e.allele_freq), 0) AS max_allele_freq,
             (SELECT COUNT(*) FROM v_high_risk_events hr WHERE hr.sample_code = l.sample_code) AS high_risk_count
      FROM lineage l
      LEFT JOIN sample p ON p.sample_id = l.parent_sample_id
      JOIN experiment x ON x.experiment_id = l.experiment_id
      JOIN cas_variant c ON c.cas_id = x.cas_id
      JOIN organism o ON o.organism_id = l.organism_id
      LEFT JOIN mutation_event e ON e.sample_id = l.sample_id
      ${experimentIdParam && Number.isInteger(experimentIdParam) ? 'WHERE l.experiment_id = ?' : ''}
      GROUP BY l.sample_id, l.sample_code, l.cell_line, l.organism_id, l.experiment_id,
               l.parent_sample_id, l.generation, l.created_date, l.status, l.notes, l.path,
               p.sample_code, x.title, c.variant_name, c.fidelity, o.common_name
      ORDER BY l.path
    `;

    const nodes = await db.query(
      baseQuery,
      experimentIdParam && Number.isInteger(experimentIdParam) ? [experimentIdParam] : [],
    );

    const branching = await db.query(`
      SELECT p.sample_code AS parent, COUNT(c.sample_id) AS children
      FROM sample p
      JOIN sample c ON c.parent_sample_id = p.sample_id
      GROUP BY p.sample_code
      ORDER BY children DESC
    `);

    res.json({ nodes, branching });
  } catch (err) {
    console.error('[GET /api/lineage]', err);
    res.status(500).json({ error: 'Failed to load genetic lineage tree.' });
  }
});

// ---------------------------------------------------------------------
// GET /api/lineage/:sampleCode/trace : Ancestors (Q16) & Descendants (Q17)
// ---------------------------------------------------------------------
apiRouter.get('/lineage/:sampleCode/trace', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sampleCode = String(req.params.sampleCode || '').trim();
    if (!sampleCode || sampleCode.length > 30) {
      res.status(400).json({ error: 'Invalid sample code.' });
      return;
    }

    const db = await getDb();
    const targetRows = await db.query('SELECT * FROM sample WHERE sample_code = ?', [sampleCode]);
    if (targetRows.length === 0) {
      res.status(404).json({ error: 'Sample not found.' });
      return;
    }

    const ancestors = await db.query(
      `
      WITH RECURSIVE ancestors AS (
        SELECT sample_id, sample_code, parent_sample_id, generation, status, 0 AS hops
        FROM sample
        WHERE sample_code = ?
        UNION ALL
        SELECT s.sample_id, s.sample_code, s.parent_sample_id, s.generation, s.status, a.hops + 1
        FROM sample s
        JOIN ancestors a ON s.sample_id = a.parent_sample_id
      )
      SELECT a.sample_id, a.sample_code, a.generation, a.status, a.hops AS generations_back,
             e.event_id, e.mutation_type, e.allele_freq, e.detected_on,
             g.guide_name, o.chromosome, o.position, o.region_type, gn.gene_symbol AS hit_gene
      FROM ancestors a
      LEFT JOIN mutation_event e ON e.sample_id = a.sample_id
      LEFT JOIN off_target_site o ON o.site_id = e.site_id
      LEFT JOIN guide_rna g ON g.guide_id = o.guide_id
      LEFT JOIN gene gn ON gn.gene_id = o.gene_id
      ORDER BY a.hops ASC, e.allele_freq DESC
      `,
      [sampleCode],
    );

    const descendants = await db.query(
      `
      WITH RECURSIVE descendants AS (
        SELECT sample_id, sample_code, generation, status, 0 AS depth
        FROM sample
        WHERE sample_code = ?
        UNION ALL
        SELECT s.sample_id, s.sample_code, s.generation, s.status, d.depth + 1
        FROM sample s
        JOIN descendants d ON s.parent_sample_id = d.sample_id
      )
      SELECT d.sample_id, d.sample_code, d.generation, d.status, d.depth,
             COUNT(e.event_id) AS mutations,
             IFNULL(MAX(e.allele_freq), 0) AS max_freq
      FROM descendants d
      LEFT JOIN mutation_event e ON e.sample_id = d.sample_id
      GROUP BY d.sample_id, d.sample_code, d.generation, d.status, d.depth
      ORDER BY d.depth ASC, d.sample_code ASC
      `,
      [sampleCode],
    );

    res.json({
      sample: targetRows[0],
      ancestors,
      descendants,
    });
  } catch (err) {
    console.error('[GET /api/lineage/:sampleCode/trace]', err);
    res.status(500).json({ error: 'Failed to trace sample lineage.' });
  }
});

// ---------------------------------------------------------------------
// Samples CRUD (Trigger T1 auto-computes generation)
// ---------------------------------------------------------------------
apiRouter.get('/samples', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const rows = await db.query(`
      SELECT s.*, p.sample_code AS parent_sample_code, x.title AS experiment_title,
             o.common_name AS organism_name,
             COUNT(e.event_id) AS mutation_count
      FROM sample s
      LEFT JOIN sample p ON p.sample_id = s.parent_sample_id
      JOIN experiment x ON x.experiment_id = s.experiment_id
      JOIN organism o ON o.organism_id = s.organism_id
      LEFT JOIN mutation_event e ON e.sample_id = s.sample_id
      GROUP BY s.sample_id, s.sample_code, s.cell_line, s.organism_id, s.experiment_id,
               s.parent_sample_id, s.generation, s.created_date, s.status, s.notes,
               p.sample_code, x.title, o.common_name
      ORDER BY s.experiment_id, s.generation, s.sample_code
    `);
    res.json({ samples: rows });
  } catch (err) {
    console.error('[GET /api/samples]', err);
    res.status(500).json({ error: 'Failed to load samples.' });
  }
});

apiRouter.post('/samples', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sampleCode, cellLine, organismId, experimentId, parentSampleId, createdDate, status, notes } =
      req.body ?? {};

    if (typeof sampleCode !== 'string' || !/^[A-Za-z0-9_-]{2,30}$/.test(sampleCode.trim())) {
      res.status(400).json({ error: 'Sample code must be 2–30 alphanumeric/hyphen/underscore characters.' });
      return;
    }
    if (typeof cellLine !== 'string' || cellLine.trim().length < 2 || cellLine.trim().length > 30) {
      res.status(400).json({ error: 'Cell line must be 2–30 characters.' });
      return;
    }
    const orgId = Number(organismId);
    const expId = Number(experimentId);
    const parentId = parentSampleId !== null && parentSampleId !== undefined && parentSampleId !== '' ? Number(parentSampleId) : null;

    if (!isPositiveInt(orgId) || !isPositiveInt(expId)) {
      res.status(400).json({ error: 'Valid organism and experiment are required.' });
      return;
    }
    if (parentId !== null && !isPositiveInt(parentId)) {
      res.status(400).json({ error: 'Invalid parent sample ID.' });
      return;
    }

    const safeStatus =
      status === 'frozen' || status === 'discarded' || status === 'active' ? status : 'active';
    const safeDate = isValidDateString(createdDate) ? createdDate : new Date().toISOString().slice(0, 10);
    const safeNotes = typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 200) : null;

    const db = await getDb();
    const existing = await db.query('SELECT sample_id FROM sample WHERE sample_code = ?', [sampleCode.trim()]);
    if (existing.length > 0) {
      res.status(409).json({ error: `Sample code "${sampleCode.trim()}" already exists.` });
      return;
    }

    if (parentId !== null) {
      const parentRows = await db.query('SELECT sample_id FROM sample WHERE sample_id = ?', [parentId]);
      if (parentRows.length === 0) {
        res.status(400).json({ error: 'Selected parent sample does not exist.' });
        return;
      }
    }

    const insertRes = await db.execute(
      `INSERT INTO sample (sample_code, cell_line, organism_id, experiment_id, parent_sample_id, created_date, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sampleCode.trim(), cellLine.trim(), orgId, expId, parentId, safeDate, safeStatus, safeNotes],
    );

    const createdRows = await db.query('SELECT * FROM sample WHERE sample_id = ?', [insertRes.insertId]);
    res.status(201).json({ sample: createdRows[0] });
  } catch (err) {
    console.error('[POST /api/samples]', err);
    res.status(500).json({ error: 'Failed to create sample.' });
  }
});

apiRouter.patch('/samples/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      res.status(400).json({ error: 'Invalid sample ID.' });
      return;
    }

    const { status, notes } = req.body ?? {};
    if (status !== undefined && status !== 'active' && status !== 'frozen' && status !== 'discarded') {
      res.status(400).json({ error: 'Status must be active, frozen, or discarded.' });
      return;
    }
    if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 200)) {
      res.status(400).json({ error: 'Notes must be at most 200 characters.' });
      return;
    }

    const db = await getDb();
    const updated = await db.transaction(async (tx) => {
      const rows = await tx.query<{ status: string; notes: string | null }>(
        'SELECT status, notes FROM sample WHERE sample_id = ?',
        [id],
      );
      if (rows.length === 0) return null;

      const nextStatus = status ?? rows[0].status;
      const nextNotes = notes !== undefined ? (notes?.trim() || null) : rows[0].notes;
      await tx.execute('UPDATE sample SET status = ?, notes = ? WHERE sample_id = ?', [
        nextStatus,
        nextNotes,
        id,
      ]);
      const refreshed = await tx.query('SELECT * FROM sample WHERE sample_id = ?', [id]);
      return refreshed[0];
    });

    if (!updated) {
      res.status(404).json({ error: 'Sample not found.' });
      return;
    }
    res.json({ sample: updated });
  } catch (err) {
    console.error('[PATCH /api/samples/:id]', err);
    res.status(500).json({ error: 'Failed to update sample.' });
  }
});

apiRouter.delete('/samples/:id', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      res.status(400).json({ error: 'Invalid sample ID.' });
      return;
    }

    const db = await getDb();
    const children = await db.query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM sample WHERE parent_sample_id = ?',
      [id],
    );
    if (Number(children[0]?.cnt ?? 0) > 0) {
      res.status(409).json({ error: 'Cannot delete a sample that has descendant clones.' });
      return;
    }

    const events = await db.query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM mutation_event WHERE sample_id = ?',
      [id],
    );
    if (Number(events[0]?.cnt ?? 0) > 0) {
      res.status(409).json({ error: 'Cannot delete a sample with recorded mutation events.' });
      return;
    }

    const delRes = await db.execute('DELETE FROM sample WHERE sample_id = ?', [id]);
    if (!delRes.affectedRows) {
      res.status(404).json({ error: 'Sample not found.' });
      return;
    }
    res.json({ deleted: true, sampleId: id });
  } catch (err) {
    console.error('[DELETE /api/samples/:id]', err);
    res.status(500).json({ error: 'Failed to delete sample.' });
  }
});

// ---------------------------------------------------------------------
// Mutations & Off-Target Report (v_offtarget_report, Q2, Q19)
// ---------------------------------------------------------------------
apiRouter.get('/mutations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const riskLevel = typeof req.query.riskLevel === 'string' ? req.query.riskLevel.toUpperCase() : '';
    const experimentId = req.query.experimentId ? Number(req.query.experimentId) : null;
    const mutationType = typeof req.query.mutationType === 'string' ? req.query.mutationType : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (riskLevel === 'HIGH' || riskLevel === 'MEDIUM' || riskLevel === 'LOW') {
      clauses.push('risk_level = ?');
      params.push(riskLevel);
    }
    if (experimentId && Number.isInteger(experimentId)) {
      clauses.push('experiment_id = ?');
      params.push(experimentId);
    }
    if (['SNV', 'insertion', 'deletion', 'indel'].includes(mutationType)) {
      clauses.push('mutation_type = ?');
      params.push(mutationType);
    }
    if (search) {
      clauses.push(
        '(LOWER(sample_code) LIKE ? OR LOWER(guide_name) LIKE ? OR LOWER(IFNULL(hit_gene, \'\')) LIKE ? OR LOWER(experiment) LIKE ?)',
      );
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const events = await db.query(
      `SELECT * FROM v_offtarget_report ${whereClause} ORDER BY allele_freq DESC`,
      params,
    );

    const unhitSites = await db.query(`
      SELECT o.site_id, g.guide_name, o.chromosome, o.position, o.mismatch_count, o.region_type,
             gn.gene_symbol AS target_gene
      FROM off_target_site o
      JOIN guide_rna g ON g.guide_id = o.guide_id
      LEFT JOIN gene gn ON gn.gene_id = o.gene_id
      LEFT JOIN mutation_event e ON e.site_id = o.site_id
      WHERE e.event_id IS NULL
      ORDER BY o.mismatch_count ASC
    `);

    const rankedInGuide = await db.query(`
      SELECT event_id, guide_name, sample_code, hit_gene, allele_freq, risk_level,
             RANK() OVER (PARTITION BY guide_name ORDER BY allele_freq DESC) AS rank_in_guide
      FROM v_offtarget_report
      ORDER BY guide_name, rank_in_guide
    `);

    res.json({ events, unhitSites, rankedInGuide });
  } catch (err) {
    console.error('[GET /api/mutations]', err);
    res.status(500).json({ error: 'Failed to load mutation events.' });
  }
});

apiRouter.post('/mutations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sampleId, siteId, mutationType, alleleFreq, detectedOn, methodId } = req.body ?? {};
    const sId = Number(sampleId);
    const stId = Number(siteId);
    const mId = Number(methodId);
    const freq = Number(alleleFreq);

    if (!isPositiveInt(sId) || !isPositiveInt(stId) || !isPositiveInt(mId)) {
      res.status(400).json({ error: 'Valid sample, off-target site, and detection method are required.' });
      return;
    }
    if (!['SNV', 'insertion', 'deletion', 'indel'].includes(String(mutationType))) {
      res.status(400).json({ error: 'Invalid mutation type.' });
      return;
    }
    if (!Number.isFinite(freq) || freq < 0 || freq > 100) {
      res.status(400).json({ error: 'Allele frequency must be between 0 and 100%.' });
      return;
    }

    const safeDate = isValidDateString(detectedOn) ? detectedOn : new Date().toISOString().slice(0, 10);

    const db = await getDb();

    // Check guide-experiment integrity (Q14)
    const integrityRows = await db.query<{ ok: number }>(
      `SELECT COUNT(*) AS ok
       FROM sample s
       JOIN off_target_site o ON o.site_id = ?
       JOIN experiment_guide eg ON eg.experiment_id = s.experiment_id AND eg.guide_id = o.guide_id
       WHERE s.sample_id = ?`,
      [stId, sId],
    );
    if (Number(integrityRows[0]?.ok ?? 0) === 0) {
      res.status(400).json({
        error: 'Selected off-target site belongs to a guide RNA not linked to this sample’s experiment.',
      });
      return;
    }

    const insertRes = await db.execute(
      `INSERT INTO mutation_event (sample_id, site_id, mutation_type, allele_freq, detected_on, method_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sId, stId, mutationType, Number(freq.toFixed(2)), safeDate, mId],
    );

    const [createdEvent] = await db.query('SELECT * FROM v_offtarget_report WHERE event_id = ?', [
      insertRes.insertId,
    ]);
    const triggeredAlerts = await db.query('SELECT * FROM alert_log WHERE event_id = ?', [
      insertRes.insertId,
    ]);

    res.status(201).json({
      event: createdEvent,
      alertTriggered: triggeredAlerts.length > 0,
      alert: triggeredAlerts[0] ?? null,
    });
  } catch (err) {
    console.error('[POST /api/mutations]', err);
    res.status(500).json({ error: 'Failed to log mutation event.' });
  }
});

// ---------------------------------------------------------------------
// Experiments & Guide RNAs
// ---------------------------------------------------------------------
apiRouter.get('/experiments', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const experiments = await db.query(`
      SELECT v.*, x.start_date, l.lab_name
      FROM v_experiment_summary v
      JOIN experiment x ON x.experiment_id = v.experiment_id
      JOIN researcher r ON r.researcher_id = x.researcher_id
      JOIN lab l ON l.lab_id = r.lab_id
      ORDER BY x.start_date DESC
    `);

    const links = await db.query(`
      SELECT eg.experiment_id, g.guide_id, g.guide_name, gn.gene_symbol
      FROM experiment_guide eg
      JOIN guide_rna g ON g.guide_id = eg.guide_id
      JOIN gene gn ON gn.gene_id = g.target_gene_id
    `);

    res.json({ experiments, guideLinks: links });
  } catch (err) {
    console.error('[GET /api/experiments]', err);
    res.status(500).json({ error: 'Failed to load experiments.' });
  }
});

apiRouter.post('/experiments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, researcherId, casId, startDate, guideIds } = req.body ?? {};
    if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 80) {
      res.status(400).json({ error: 'Experiment title must be 3–80 characters.' });
      return;
    }
    const rId = Number(researcherId);
    const cId = Number(casId);
    if (!isPositiveInt(rId) || !isPositiveInt(cId)) {
      res.status(400).json({ error: 'Valid researcher and Cas variant are required.' });
      return;
    }

    const parsedGuides = Array.isArray(guideIds)
      ? guideIds.map(Number).filter((id) => isPositiveInt(id))
      : [];
    if (parsedGuides.length === 0) {
      res.status(400).json({ error: 'Select at least one guide RNA for the experiment.' });
      return;
    }

    const safeDate = isValidDateString(startDate) ? startDate : new Date().toISOString().slice(0, 10);
    const db = await getDb();

    const expId = await db.transaction(async (tx) => {
      const ins = await tx.execute(
        'INSERT INTO experiment (title, researcher_id, cas_id, start_date) VALUES (?, ?, ?, ?)',
        [title.trim(), rId, cId, safeDate],
      );
      const newId = Number(ins.insertId);
      for (const gid of parsedGuides) {
        await tx.execute('INSERT INTO experiment_guide (experiment_id, guide_id) VALUES (?, ?)', [
          newId,
          gid,
        ]);
      }
      return newId;
    });

    const [created] = await db.query('SELECT * FROM v_experiment_summary WHERE experiment_id = ?', [expId]);
    res.status(201).json({ experiment: created });
  } catch (err) {
    console.error('[POST /api/experiments]', err);
    res.status(500).json({ error: 'Failed to create experiment.' });
  }
});

apiRouter.get('/guides', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const guides = await db.query(`
      SELECT g.guide_id, g.guide_name, g.spacer_seq, g.pam_seq, g.on_target_score,
             gn.gene_symbol AS target_gene, gn.chromosome AS target_chromosome,
             gn.gene_type AS target_gene_type, o.scientific_name AS organism,
             COUNT(DISTINCT ots.site_id) AS predicted_sites,
             COUNT(e.event_id) AS detected_mutations,
             IFNULL(ROUND(AVG(e.allele_freq), 2), 0) AS avg_freq,
             IFNULL(MAX(e.allele_freq), 0) AS worst_freq,
             IFNULL(ROUND(SUM(e.allele_freq), 2), 0) AS total_load
      FROM guide_rna g
      JOIN gene gn ON gn.gene_id = g.target_gene_id
      JOIN organism o ON o.organism_id = gn.organism_id
      LEFT JOIN off_target_site ots ON ots.guide_id = g.guide_id
      LEFT JOIN mutation_event e ON e.site_id = ots.site_id
      GROUP BY g.guide_id, g.guide_name, g.spacer_seq, g.pam_seq, g.on_target_score,
               gn.gene_symbol, gn.chromosome, gn.gene_type, o.scientific_name
      ORDER BY total_load DESC, g.on_target_score DESC
    `);

    const sites = await db.query(`
      SELECT ots.*, g.guide_name, gn.gene_symbol
      FROM off_target_site ots
      JOIN guide_rna g ON g.guide_id = ots.guide_id
      LEFT JOIN gene gn ON gn.gene_id = ots.gene_id
      ORDER BY g.guide_name, ots.mismatch_count ASC
    `);

    res.json({ guides, sites });
  } catch (err) {
    console.error('[GET /api/guides]', err);
    res.status(500).json({ error: 'Failed to load guide RNAs.' });
  }
});

apiRouter.post('/guides', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { guideName, spacerSeq, pamSeq, targetGeneId, onTargetScore } = req.body ?? {};
    if (typeof guideName !== 'string' || !/^[A-Za-z0-9_-]{3,30}$/.test(guideName.trim())) {
      res.status(400).json({ error: 'Guide name must be 3–30 alphanumeric/underscore/hyphen characters.' });
      return;
    }
    const cleanSpacer = typeof spacerSeq === 'string' ? spacerSeq.trim().toUpperCase() : '';
    if (!/^[ACGT]{20}$/.test(cleanSpacer)) {
      res.status(400).json({ error: 'Spacer sequence must be exactly 20 DNA bases (A, C, G, T).' });
      return;
    }
    const cleanPam = typeof pamSeq === 'string' ? pamSeq.trim().toUpperCase() : '';
    if (!/^[ACGTNR]{2,6}$/.test(cleanPam)) {
      res.status(400).json({ error: 'PAM sequence must be 2–6 IUPAC bases.' });
      return;
    }
    const geneId = Number(targetGeneId);
    const score = Number(onTargetScore);
    if (!isPositiveInt(geneId)) {
      res.status(400).json({ error: 'Valid target gene is required.' });
      return;
    }
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      res.status(400).json({ error: 'On-target score must be between 0 and 100.' });
      return;
    }

    const db = await getDb();
    const existing = await db.query('SELECT guide_id FROM guide_rna WHERE guide_name = ?', [guideName.trim()]);
    if (existing.length > 0) {
      res.status(409).json({ error: 'A guide RNA with that name already exists.' });
      return;
    }

    const ins = await db.execute(
      `INSERT INTO guide_rna (guide_name, spacer_seq, pam_seq, target_gene_id, on_target_score)
       VALUES (?, ?, ?, ?, ?)`,
      [guideName.trim(), cleanSpacer, cleanPam, geneId, Number(score.toFixed(1))],
    );

    const [created] = await db.query('SELECT * FROM guide_rna WHERE guide_id = ?', [ins.insertId]);
    res.status(201).json({ guide: created });
  } catch (err) {
    console.error('[POST /api/guides]', err);
    res.status(500).json({ error: 'Failed to create guide RNA.' });
  }
});

apiRouter.post('/off-target-sites', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { guideId, chromosome, position, mismatchCount, regionType, geneId } = req.body ?? {};
    const gId = Number(guideId);
    const pos = Number(position);
    const mm = Number(mismatchCount);
    const gnId = geneId !== null && geneId !== undefined && geneId !== '' ? Number(geneId) : null;

    if (!isPositiveInt(gId) || !isPositiveInt(pos)) {
      res.status(400).json({ error: 'Valid guide RNA and genomic position are required.' });
      return;
    }
    if (typeof chromosome !== 'string' || !/^[A-Za-z0-9]{1,5}$/.test(chromosome.trim())) {
      res.status(400).json({ error: 'Chromosome must be 1–5 characters (e.g., 17, X).' });
      return;
    }
    if (!Number.isInteger(mm) || mm < 1 || mm > 5) {
      res.status(400).json({ error: 'Mismatch count must be an integer between 1 and 5.' });
      return;
    }
    if (!['exon', 'intron', 'intergenic'].includes(String(regionType))) {
      res.status(400).json({ error: 'Region type must be exon, intron, or intergenic.' });
      return;
    }
    if (regionType === 'intergenic' && gnId !== null) {
      res.status(400).json({ error: 'Intergenic sites cannot reference a gene.' });
      return;
    }

    const db = await getDb();
    const ins = await db.execute(
      `INSERT INTO off_target_site (guide_id, chromosome, position, mismatch_count, region_type, gene_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [gId, chromosome.trim(), pos, mm, regionType, gnId],
    );
    const [created] = await db.query('SELECT * FROM off_target_site WHERE site_id = ?', [ins.insertId]);
    res.status(201).json({ site: created });
  } catch (err) {
    console.error('[POST /api/off-target-sites]', err);
    res.status(500).json({ error: 'Failed to add predicted off-target site.' });
  }
});

// ---------------------------------------------------------------------
// Alerts, High-Risk Events & Audit Queries (Q11, Q13, Q14)
// ---------------------------------------------------------------------
apiRouter.get('/alerts', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();

    const alertLogs = await db.query(`
      SELECT a.alert_id, a.event_id, a.message, a.created_at,
             r.experiment, r.sample_code, r.guide_name, r.hit_gene, r.allele_freq, r.risk_level
      FROM alert_log a
      JOIN v_offtarget_report r ON r.event_id = a.event_id
      ORDER BY a.alert_id DESC
    `);

    const highRiskEvents = await db.query(`
      SELECT * FROM v_high_risk_events ORDER BY allele_freq DESC
    `);

    const tumorSuppressorSamples = await db.query(`
      SELECT s.sample_code, s.cell_line, s.generation, s.status, s.notes
      FROM sample s
      WHERE s.sample_id IN (
        SELECT e.sample_id
        FROM mutation_event e
        JOIN off_target_site o ON o.site_id = e.site_id
        JOIN gene gn ON gn.gene_id = o.gene_id
        WHERE gn.gene_type IN ('tumor_suppressor', 'oncogene')
      )
      ORDER BY s.sample_code
    `);

    const cleanSamples = await db.query(`
      SELECT s.sample_code, s.cell_line, s.generation, s.status, x.title AS experiment_title
      FROM sample s
      JOIN experiment x ON x.experiment_id = s.experiment_id
      WHERE NOT EXISTS (
        SELECT 1 FROM mutation_event e WHERE e.sample_id = s.sample_id
      )
      ORDER BY s.sample_code
    `);

    const [integrity] = await db.query<{ orphan_events: number }>(`
      SELECT COUNT(*) AS orphan_events
      FROM mutation_event e
      JOIN sample s ON s.sample_id = e.sample_id
      JOIN off_target_site o ON o.site_id = e.site_id
      JOIN guide_rna g ON g.guide_id = o.guide_id
      WHERE NOT EXISTS (
        SELECT 1 FROM experiment_guide eg
        WHERE eg.experiment_id = s.experiment_id AND eg.guide_id = g.guide_id
      )
    `);

    res.json({
      alertLogs,
      highRiskEvents,
      tumorSuppressorSamples,
      cleanSamples,
      integrityOrphanEvents: Number(integrity?.orphan_events ?? 0),
    });
  } catch (err) {
    console.error('[GET /api/alerts]', err);
    res.status(500).json({ error: 'Failed to load alerts and integrity audit.' });
  }
});

// ---------------------------------------------------------------------
// Reference lookups + Third-party NCBI Entrez Gene lookup
// ---------------------------------------------------------------------
apiRouter.get('/reference', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const [organisms, labs, researchers, casVariants, detectionMethods, genes, offTargetSites, experiments, guideLinks] =
      await Promise.all([
        db.query('SELECT * FROM organism ORDER BY organism_id'),
        db.query('SELECT * FROM lab ORDER BY lab_id'),
        db.query('SELECT * FROM researcher ORDER BY researcher_id'),
        db.query('SELECT * FROM cas_variant ORDER BY cas_id'),
        db.query('SELECT * FROM detection_method ORDER BY method_id'),
        db.query('SELECT g.*, o.scientific_name FROM gene g JOIN organism o ON o.organism_id = g.organism_id ORDER BY g.gene_symbol'),
        db.query(`
          SELECT ots.*, g.guide_name, gn.gene_symbol
          FROM off_target_site ots
          JOIN guide_rna g ON g.guide_id = ots.guide_id
          LEFT JOIN gene gn ON gn.gene_id = ots.gene_id
          ORDER BY g.guide_name, ots.site_id
        `),
        db.query('SELECT experiment_id, title FROM experiment ORDER BY experiment_id'),
        db.query('SELECT experiment_id, guide_id FROM experiment_guide'),
      ]);

    res.json({
      organisms,
      labs,
      researchers,
      casVariants,
      detectionMethods,
      genes,
      offTargetSites,
      experiments,
      guideLinks,
    });
  } catch (err) {
    console.error('[GET /api/reference]', err);
    res.status(500).json({ error: 'Failed to load reference catalogs.' });
  }
});

apiRouter.get('/genes/:symbol/ncbi', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const symbol = String(req.params.symbol || '').trim();
    const organism = typeof req.query.organism === 'string' ? req.query.organism : 'Homo sapiens';
    const annotation = await lookupGeneOnNcbi(symbol, organism);
    res.json({ annotation });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_GENE_SYMBOL') {
      res.status(400).json({ error: 'Invalid gene symbol.' });
      return;
    }
    console.error('[GET /api/genes/:symbol/ncbi]', err);
    res.status(500).json({ error: 'Failed to query NCBI gene annotation.' });
  }
});
