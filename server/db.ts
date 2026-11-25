import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase } from 'sql.js';

export type DbDialect = 'mysql' | 'sqlite';

export interface QueryResult {
  insertId?: number;
  affectedRows?: number;
}

export interface DbAdapter {
  dialect: DbDialect;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  transaction<T>(fn: (tx: Pick<DbAdapter, 'query' | 'execute'>) => Promise<T>): Promise<T>;
}

const SQLITE_SCHEMA_AND_SEED = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organism (
    organism_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    common_name     TEXT NOT NULL,
    scientific_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS lab (
    lab_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_name   TEXT NOT NULL UNIQUE,
    department TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS researcher (
    researcher_id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name     TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    lab_id        INTEGER NOT NULL,
    FOREIGN KEY (lab_id) REFERENCES lab(lab_id)
);

CREATE TABLE IF NOT EXISTS app_user (
    user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name     TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'researcher' CHECK (role IN ('admin','researcher')),
    lab_id        INTEGER NULL,
    created_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES lab(lab_id)
);

CREATE TABLE IF NOT EXISTS cas_variant (
    cas_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_name TEXT NOT NULL UNIQUE,
    pam_motif    TEXT NOT NULL,
    fidelity     TEXT NOT NULL CHECK (fidelity IN ('Standard','High'))
);

CREATE TABLE IF NOT EXISTS detection_method (
    method_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    method_name    TEXT NOT NULL UNIQUE,
    is_genome_wide INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gene (
    gene_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    gene_symbol TEXT NOT NULL,
    organism_id INTEGER NOT NULL,
    chromosome  TEXT NOT NULL,
    gene_type   TEXT NOT NULL DEFAULT 'other' CHECK (gene_type IN ('tumor_suppressor','oncogene','other')),
    UNIQUE (gene_symbol, organism_id),
    FOREIGN KEY (organism_id) REFERENCES organism(organism_id)
);

CREATE TABLE IF NOT EXISTS guide_rna (
    guide_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    guide_name      TEXT NOT NULL UNIQUE,
    spacer_seq      TEXT NOT NULL CHECK (LENGTH(spacer_seq) = 20),
    pam_seq         TEXT NOT NULL,
    target_gene_id  INTEGER NOT NULL,
    on_target_score REAL CHECK (on_target_score BETWEEN 0 AND 100),
    FOREIGN KEY (target_gene_id) REFERENCES gene(gene_id)
);

CREATE TABLE IF NOT EXISTS experiment (
    experiment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    researcher_id INTEGER NOT NULL,
    cas_id        INTEGER NOT NULL,
    start_date    TEXT NOT NULL,
    FOREIGN KEY (researcher_id) REFERENCES researcher(researcher_id),
    FOREIGN KEY (cas_id)        REFERENCES cas_variant(cas_id)
);

CREATE TABLE IF NOT EXISTS experiment_guide (
    experiment_id INTEGER NOT NULL,
    guide_id      INTEGER NOT NULL,
    PRIMARY KEY (experiment_id, guide_id),
    FOREIGN KEY (experiment_id) REFERENCES experiment(experiment_id),
    FOREIGN KEY (guide_id)      REFERENCES guide_rna(guide_id)
);

CREATE TABLE IF NOT EXISTS sample (
    sample_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_code      TEXT NOT NULL UNIQUE,
    cell_line        TEXT NOT NULL,
    organism_id      INTEGER NOT NULL,
    experiment_id    INTEGER NOT NULL,
    parent_sample_id INTEGER NULL,
    generation       INTEGER NOT NULL DEFAULT 0,
    created_date     TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','discarded')),
    notes            TEXT NULL,
    FOREIGN KEY (organism_id)      REFERENCES organism(organism_id),
    FOREIGN KEY (experiment_id)    REFERENCES experiment(experiment_id),
    FOREIGN KEY (parent_sample_id) REFERENCES sample(sample_id)
);

CREATE TABLE IF NOT EXISTS off_target_site (
    site_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    guide_id       INTEGER NOT NULL,
    chromosome     TEXT NOT NULL,
    position       INTEGER NOT NULL,
    mismatch_count INTEGER NOT NULL CHECK (mismatch_count BETWEEN 1 AND 5),
    region_type    TEXT NOT NULL CHECK (region_type IN ('exon','intron','intergenic')),
    gene_id        INTEGER NULL,
    FOREIGN KEY (guide_id) REFERENCES guide_rna(guide_id),
    FOREIGN KEY (gene_id)  REFERENCES gene(gene_id)
);

CREATE TABLE IF NOT EXISTS mutation_event (
    event_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id     INTEGER NOT NULL,
    site_id       INTEGER NOT NULL,
    mutation_type TEXT NOT NULL CHECK (mutation_type IN ('SNV','insertion','deletion','indel')),
    allele_freq   REAL NOT NULL CHECK (allele_freq BETWEEN 0 AND 100),
    detected_on   TEXT NOT NULL,
    method_id     INTEGER NOT NULL,
    FOREIGN KEY (sample_id) REFERENCES sample(sample_id),
    FOREIGN KEY (site_id)   REFERENCES off_target_site(site_id),
    FOREIGN KEY (method_id) REFERENCES detection_method(method_id)
);

CREATE TABLE IF NOT EXISTS alert_log (
    alert_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   INTEGER NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES mutation_event(event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_sample ON mutation_event(sample_id);
CREATE INDEX IF NOT EXISTS idx_event_site   ON mutation_event(site_id);
CREATE INDEX IF NOT EXISTS idx_event_freq   ON mutation_event(allele_freq);
CREATE INDEX IF NOT EXISTS idx_site_guide   ON off_target_site(guide_id);

CREATE TRIGGER IF NOT EXISTS trg_sample_generation_root
AFTER INSERT ON sample
WHEN NEW.parent_sample_id IS NULL
BEGIN
    UPDATE sample SET generation = 0 WHERE sample_id = NEW.sample_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sample_generation_child
AFTER INSERT ON sample
WHEN NEW.parent_sample_id IS NOT NULL
BEGIN
    UPDATE sample
    SET generation = (SELECT generation + 1 FROM sample WHERE sample_id = NEW.parent_sample_id)
    WHERE sample_id = NEW.sample_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_high_freq_alert
AFTER INSERT ON mutation_event
WHEN NEW.allele_freq >= 5
BEGIN
    INSERT INTO alert_log(event_id, message)
    VALUES (
        NEW.event_id,
        'High off-target frequency (' || printf('%.2f', NEW.allele_freq) || '%) in sample ' || NEW.sample_id
    );
END;

CREATE VIEW IF NOT EXISTS v_offtarget_report AS
SELECT e.event_id,
       x.experiment_id,
       x.title            AS experiment,
       s.sample_code,
       s.generation,
       g.guide_name,
       o.chromosome,
       o.position,
       o.mismatch_count,
       o.region_type,
       og.gene_symbol     AS hit_gene,
       og.gene_type,
       e.mutation_type,
       e.allele_freq,
       m.method_name,
       e.detected_on,
       CASE
           WHEN e.allele_freq >= 5
             OR (o.region_type = 'exon' AND og.gene_type IN ('tumor_suppressor','oncogene'))
           THEN 'HIGH'
           WHEN e.allele_freq >= 1 THEN 'MEDIUM'
           ELSE 'LOW'
       END AS risk_level
FROM mutation_event e
JOIN sample s            ON s.sample_id     = e.sample_id
JOIN experiment x        ON x.experiment_id = s.experiment_id
JOIN off_target_site o   ON o.site_id       = e.site_id
JOIN guide_rna g         ON g.guide_id      = o.guide_id
JOIN detection_method m  ON m.method_id     = e.method_id
LEFT JOIN gene og        ON og.gene_id      = o.gene_id;

CREATE VIEW IF NOT EXISTS v_high_risk_events AS
SELECT * FROM v_offtarget_report WHERE risk_level = 'HIGH';

CREATE VIEW IF NOT EXISTS v_experiment_summary AS
SELECT x.experiment_id,
       x.title,
       r.full_name    AS researcher,
       c.variant_name AS cas_variant,
       c.fidelity,
       COUNT(DISTINCT s.sample_id) AS total_samples,
       COUNT(e.event_id)           AS total_mutations,
       IFNULL(MAX(e.allele_freq), 0)          AS max_freq,
       IFNULL(ROUND(AVG(e.allele_freq), 2), 0) AS avg_freq
FROM experiment x
JOIN researcher r   ON r.researcher_id = x.researcher_id
JOIN cas_variant c  ON c.cas_id        = x.cas_id
LEFT JOIN sample s  ON s.experiment_id = x.experiment_id
LEFT JOIN mutation_event e ON e.sample_id = s.sample_id
GROUP BY x.experiment_id, x.title, r.full_name, c.variant_name, c.fidelity;
`;

const SQLITE_SEED_DATA = `
INSERT INTO organism(common_name, scientific_name) VALUES
('Human','Homo sapiens'), ('Mouse','Mus musculus'), ('Zebrafish','Danio rerio');

INSERT INTO lab(lab_name, department) VALUES
('Genome Editing Lab','Biotechnology'), ('Cell Biology Lab','Life Sciences');

INSERT INTO researcher(full_name, email, lab_id) VALUES
('Dr. Anita Rao',   'anita.rao@lab.in',   1),
('Rohan Mehta',     'rohan.mehta@lab.in', 1),
('Dr. Kiran Shetty','kiran.shetty@lab.in',2),
('Sneha Iyer',      'sneha.iyer@lab.in',  2);

INSERT INTO cas_variant(variant_name, pam_motif, fidelity) VALUES
('SpCas9',     'NGG',    'Standard'),
('SpCas9-HF1', 'NGG',    'High'),
('eSpCas9',    'NGG',    'High'),
('SaCas9',     'NNGRRT', 'Standard');

INSERT INTO detection_method(method_name, is_genome_wide) VALUES
('GUIDE-seq', 1), ('Digenome-seq', 1),
('Targeted amplicon NGS', 0), ('T7E1 assay', 0);

INSERT INTO gene(gene_symbol, organism_id, chromosome, gene_type) VALUES
('HBB',  1, '11', 'other'),
('CCR5', 1, '3',  'other'),
('TP53', 1, '17', 'tumor_suppressor'),
('BRCA1',1, '17', 'tumor_suppressor'),
('EMX1', 1, '2',  'other'),
('Tyr',  2, '7',  'other'),
('VEGFA',1, '6',  'other'),
('MYC',  1, '8',  'oncogene');

INSERT INTO guide_rna(guide_name, spacer_seq, pam_seq, target_gene_id, on_target_score) VALUES
('sg_HBB_1',   'CTTGCCCCACAGGGCAGTAA', 'AGG',    1, 88.5),
('sg_CCR5_1',  'TGACATCAATTATTATACAT', 'CGG',    2, 92.0),
('sg_EMX1_1',  'GAGTCCGAGCAGAAGAAGAA', 'GGG',    5, 85.3),
('sg_VEGFA_3', 'GGTGAGTGAGTGTGTGCGTG', 'TGG',    7, 79.8),
('sg_Tyr_1',   'GGTGGATGGCCTGAACCACC', 'CAGGGT', 6, 90.1),
('sg_TP53_1',  'CCCCGGACGATATTGAACAA', 'TGG',    3, 83.4);

INSERT INTO experiment(title, researcher_id, cas_id, start_date) VALUES
('HBB correction in HEK293',       1, 1, '2026-01-10'),
('CCR5 knockout in T-cells',       3, 1, '2026-02-05'),
('EMX1 high-fidelity benchmark',   2, 3, '2026-03-01'),
('VEGFA off-target profiling',     4, 1, '2026-03-20'),
('Mouse Tyr albinism model',       3, 4, '2026-04-15');

INSERT INTO experiment_guide(experiment_id, guide_id) VALUES
(1,1),(1,6),(2,2),(3,3),(4,4),(4,3),(5,5);

INSERT INTO sample(sample_code, cell_line, organism_id, experiment_id, parent_sample_id, created_date, status) VALUES
('HEK-WT',      'HEK293',         1, 1, NULL, '2026-01-10', 'frozen'),
('HEK-C1',      'HEK293',         1, 1, 1,    '2026-01-25', 'active'),
('HEK-C1-A',    'HEK293',         1, 1, 2,    '2026-02-08', 'active'),
('HEK-C1-B',    'HEK293',         1, 1, 2,    '2026-02-08', 'discarded'),
('HEK-C1-A1',   'HEK293',         1, 1, 3,    '2026-02-22', 'active'),
('TC-WT',       'Primary T-cell', 1, 2, NULL, '2026-02-05', 'frozen'),
('TC-KO1',      'Primary T-cell', 1, 2, 6,    '2026-02-20', 'active'),
('TC-KO1-A',    'Primary T-cell', 1, 2, 7,    '2026-03-05', 'active'),
('HEK-EMX1',    'HEK293',         1, 3, 1,    '2026-03-01', 'active'),
('HEK-EMX1-A',  'HEK293',         1, 3, 9,    '2026-03-15', 'active'),
('HeLa-WT',     'HeLa',           1, 4, NULL, '2026-03-20', 'frozen'),
('HeLa-V1',     'HeLa',           1, 4, 11,   '2026-03-30', 'active'),
('HeLa-V1-A',   'HeLa',           1, 4, 12,   '2026-04-08', 'active'),
('mESC-WT',     'Mouse ESC',      2, 5, NULL, '2026-04-15', 'frozen'),
('mESC-Tyr1',   'Mouse ESC',      2, 5, 14,   '2026-04-28', 'active');

INSERT INTO off_target_site(guide_id, chromosome, position, mismatch_count, region_type, gene_id) VALUES
(1,'11', 5226100,   2,'intergenic',NULL),
(1,'17', 7676200,   3,'intron',    3),
(2,'3',  46414900,  1,'intergenic',NULL),
(2,'17', 43044300,  3,'exon',      4),
(3,'2',  72933800,  2,'intergenic',NULL),
(3,'8',  127740000, 4,'intron',    8),
(4,'6',  43770200,  1,'intron',    7),
(4,'17', 7675100,   2,'exon',      3),
(4,'11', 5225500,   3,'intron',    1),
(5,'7',  87000100,  2,'intron',    6),
(6,'5',  1295200,   3,'intergenic',NULL),
(1,'2',  72933000,  4,'intron',    5);

INSERT INTO mutation_event(sample_id, site_id, mutation_type, allele_freq, detected_on, method_id) VALUES
(2, 1, 'indel',     1.20, '2026-02-01', 3),
(3, 2, 'SNV',       0.45, '2026-02-15', 3),
(3, 1, 'deletion',  2.30, '2026-02-15', 3),
(4, 1, 'indel',     0.80, '2026-02-15', 1),
(5, 2, 'insertion', 3.10, '2026-03-02', 3),
(5,12, 'SNV',       0.30, '2026-03-02', 3),
(7, 3, 'indel',     0.90, '2026-03-01', 1),
(7, 4, 'deletion',  5.60, '2026-03-01', 1),
(8, 4, 'deletion',  6.20, '2026-03-12', 3),
(8, 3, 'SNV',       0.20, '2026-03-12', 2),
(9, 5, 'indel',     0.15, '2026-03-25', 3),
(10,6, 'SNV',       0.10, '2026-04-02', 3),
(12,7, 'indel',     4.50, '2026-04-10', 1),
(12,8, 'deletion',  7.80, '2026-04-10', 1),
(13,8, 'deletion',  9.40, '2026-04-20', 3),
(13,9, 'SNV',       1.10, '2026-04-20', 3),
(13,7, 'insertion', 2.60, '2026-04-20', 2),
(15,10,'indel',     1.90, '2026-05-05', 3),
(12,9, 'SNV',       0.60, '2026-04-10', 3);

UPDATE sample SET notes = 'Needs re-sequencing'
WHERE sample_code IN (SELECT DISTINCT sample_code FROM v_high_risk_events);
`;

function toSqlParams(params: unknown[]): (string | number | Uint8Array | null)[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'number' || typeof p === 'string' || p instanceof Uint8Array) return p;
    return String(p);
  });
}

function createSqliteAdapter(sqliteDb: SqlJsDatabase, dbFilePath: string): DbAdapter {
  const persist = () => {
    const data = sqliteDb.export();
    fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
    fs.writeFileSync(dbFilePath, Buffer.from(data));
  };

  const runQuery = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const stmt = sqliteDb.prepare(sql);
    try {
      stmt.bind(toSqlParams(params));
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  };

  const runExecute = async (sql: string, params: unknown[] = [], skipPersist = false): Promise<QueryResult> => {
    const stmt = sqliteDb.prepare(sql);
    try {
      stmt.bind(toSqlParams(params));
      stmt.step();
    } finally {
      stmt.free();
    }
    const idRows = await runQuery<{ id: number }>('SELECT last_insert_rowid() AS id');
    const changeRows = await runQuery<{ ch: number }>('SELECT changes() AS ch');
    if (!skipPersist) {
      persist();
    }
    return {
      insertId: idRows[0]?.id ?? 0,
      affectedRows: changeRows[0]?.ch ?? 0,
    };
  };

  return {
    dialect: 'sqlite',
    query: runQuery,
    execute: (sql, params) => runExecute(sql, params, false),
    async transaction<T>(fn: (tx: Pick<DbAdapter, 'query' | 'execute'>) => Promise<T>): Promise<T> {
      sqliteDb.run('BEGIN TRANSACTION');
      try {
        const result = await fn({
          query: runQuery,
          execute: (sql, params) => runExecute(sql, params, true),
        });
        sqliteDb.run('COMMIT');
        persist();
        return result;
      } catch (err) {
        sqliteDb.run('ROLLBACK');
        throw err;
      }
    },
  };
}

function createMysqlAdapter(pool: mysql.Pool): DbAdapter {
  return {
    dialect: 'mysql',
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const [rows] = await pool.query(sql, toSqlParams(params));
      return rows as T[];
    },
    async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
      const [result] = await pool.execute<mysql.ResultSetHeader>(sql, toSqlParams(params));
      return {
        insertId: result.insertId,
        affectedRows: result.affectedRows,
      };
    },
    async transaction<T>(fn: (tx: Pick<DbAdapter, 'query' | 'execute'>) => Promise<T>): Promise<T> {
      const conn = await pool.getConnection();
      await conn.beginTransaction();
      try {
        const result = await fn({
          async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
            const [rows] = await conn.query(sql, toSqlParams(params));
            return rows as R[];
          },
          async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
            const [res] = await conn.execute<mysql.ResultSetHeader>(sql, toSqlParams(params));
            return {
              insertId: res.insertId,
              affectedRows: res.affectedRows,
            };
          },
        });
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}

let dbPromise: Promise<DbAdapter> | null = null;

export function getDb(): Promise<DbAdapter> {
  if (!dbPromise) {
    dbPromise = initDb();
  }
  return dbPromise;
}

async function initDb(): Promise<DbAdapter> {
  const dbClientEnv = process.env.DB_CLIENT?.trim().toLowerCase();
  const mysqlHost = process.env.MYSQL_HOST?.trim() || '';
  const isPlaceholderHost =
    !mysqlHost ||
    /^my_/i.test(mysqlHost) ||
    mysqlHost === 'mysql_host' ||
    mysqlHost === 'your_mysql_host';

  const useMysql =
    dbClientEnv === 'mysql' &&
    !isPlaceholderHost &&
    Boolean(process.env.MYSQL_USER?.trim() && process.env.MYSQL_DATABASE?.trim());

  if (useMysql) {
    const pool = mysql.createPool({
      host: mysqlHost,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'crispr_tracker',
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 4000,
    });

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_user (
          user_id       INT AUTO_INCREMENT PRIMARY KEY,
          full_name     VARCHAR(80) NOT NULL,
          email         VARCHAR(100) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          role          ENUM('admin','researcher') NOT NULL DEFAULT 'researcher',
          lab_id        INT NULL,
          created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (lab_id) REFERENCES lab(lab_id)
        )
      `);

      console.log('[db] Connected to MySQL 8.0+ database:', process.env.MYSQL_DATABASE || 'crispr_tracker');
      return createMysqlAdapter(pool);
    } catch (err) {
      console.warn(
        '[db] MySQL connection unavailable, falling back to embedded SQLite:',
        err instanceof Error ? err.message : String(err),
      );
      await pool.end().catch(() => {});
    }
  }

  const SQL = await initSqlJs();
  const dbFilePath = path.resolve(process.cwd(), 'database', 'crispr_tracker.sqlite');
  let sqliteDb: SqlJsDatabase;

  if (fs.existsSync(dbFilePath)) {
    const buffer = fs.readFileSync(dbFilePath);
    sqliteDb = new SQL.Database(buffer);
    sqliteDb.run('PRAGMA foreign_keys = ON;');
  } else {
    sqliteDb = new SQL.Database();
    sqliteDb.run(SQLITE_SCHEMA_AND_SEED);
    sqliteDb.run(SQLITE_SEED_DATA);
    fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
    fs.writeFileSync(dbFilePath, Buffer.from(sqliteDb.export()));
  }

  console.log('[db] Initialized embedded SQLite database (crispr_tracker schema)');
  return createSqliteAdapter(sqliteDb, dbFilePath);
}
