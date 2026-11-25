export interface NcbiGeneAnnotation {
  symbol: string;
  organism: string;
  ncbiGeneId: string | null;
  officialName: string;
  chromosome: string;
  mapLocation: string | null;
  summary: string;
  source: 'ncbi_live' | 'local_reference';
  apiKeyConfigured: boolean;
}

const CURATED_GENE_REFERENCE: Record<string, Omit<NcbiGeneAnnotation, 'source' | 'apiKeyConfigured'>> = {
  HBB: {
    symbol: 'HBB',
    organism: 'Homo sapiens',
    ncbiGeneId: '3043',
    officialName: 'hemoglobin subunit beta',
    chromosome: '11',
    mapLocation: '11p15.4',
    summary:
      'Encodes the beta-globin subunit of adult hemoglobin (HbA). Primary therapeutic editing target for sickle cell disease and beta-thalassemia.',
  },
  CCR5: {
    symbol: 'CCR5',
    organism: 'Homo sapiens',
    ncbiGeneId: '1234',
    officialName: 'C-C motif chemokine receptor 5',
    chromosome: '3',
    mapLocation: '3p21.31',
    summary:
      'Encodes a G-protein-coupled chemokine receptor on T-cells that serves as a major co-receptor for macrophage-tropic HIV-1 entry.',
  },
  TP53: {
    symbol: 'TP53',
    organism: 'Homo sapiens',
    ncbiGeneId: '7157',
    officialName: 'tumor protein p53',
    chromosome: '17',
    mapLocation: '17p13.1',
    summary:
      'Critical tumor suppressor encoding p53, regulating cell cycle arrest, apoptosis, and DNA damage response. Off-target exon disruption poses high oncogenic risk.',
  },
  BRCA1: {
    symbol: 'BRCA1',
    organism: 'Homo sapiens',
    ncbiGeneId: '672',
    officialName: 'BRCA1 DNA repair associated',
    chromosome: '17',
    mapLocation: '17q21.31',
    summary:
      'Nuclear phosphoprotein involved in homologous recombination repair and genomic stability. Exon indels impair double-strand break repair fidelity.',
  },
  EMX1: {
    symbol: 'EMX1',
    organism: 'Homo sapiens',
    ncbiGeneId: '2016',
    officialName: 'empty spiracles homeobox 1',
    chromosome: '2',
    mapLocation: '2p13.2',
    summary:
      'Transcription factor expressed in developing cerebral cortex; widely used benchmark locus for SpCas9 and high-fidelity Cas9 specificity profiling.',
  },
  VEGFA: {
    symbol: 'VEGFA',
    organism: 'Homo sapiens',
    ncbiGeneId: '7422',
    officialName: 'vascular endothelial growth factor A',
    chromosome: '6',
    mapLocation: '6p21.1',
    summary:
      'Growth factor inducing angiogenesis and endothelial cell proliferation. Site 3 is a known high-off-target benchmark locus.',
  },
  MYC: {
    symbol: 'MYC',
    organism: 'Homo sapiens',
    ncbiGeneId: '4609',
    officialName: 'MYC proto-oncogene, bHLH transcription factor',
    chromosome: '8',
    mapLocation: '8q24.21',
    summary:
      'Proto-oncogene encoding a nuclear phosphoprotein controlling proliferation, apoptosis, and cellular transformation.',
  },
  Tyr: {
    symbol: 'Tyr',
    organism: 'Mus musculus',
    ncbiGeneId: '22173',
    officialName: 'tyrosinase',
    chromosome: '7',
    mapLocation: '7 D3',
    summary:
      'Catalyzes rate-limiting steps in melanin biosynthesis. Loss-of-function alleles produce classic coat albinism in mouse models.',
  },
};

const NCBI_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export async function lookupGeneOnNcbi(symbol: string, organism = 'Homo sapiens'): Promise<NcbiGeneAnnotation> {
  const cleanSymbol = symbol.trim();
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(cleanSymbol)) {
    throw new Error('INVALID_GENE_SYMBOL');
  }

  const allowedOrganism =
    organism === 'Mus musculus' || organism === 'Danio rerio' ? organism : 'Homo sapiens';
  const rawApiKey = process.env.NCBI_API_KEY?.trim() || '';
  const apiKey =
    !rawApiKey || /^my_/i.test(rawApiKey) || rawApiKey.toLowerCase() === 'ncbi_api_key'
      ? ''
      : rawApiKey;
  const apiKeyConfigured = apiKey.length > 0;

  try {
    const searchUrl = new URL(`${NCBI_BASE_URL}/esearch.fcgi`);
    searchUrl.searchParams.set('db', 'gene');
    searchUrl.searchParams.set('term', `${cleanSymbol}[Gene Name] AND ${allowedOrganism}[Organism]`);
    searchUrl.searchParams.set('retmode', 'json');
    searchUrl.searchParams.set('retmax', '1');
    if (apiKeyConfigured) {
      searchUrl.searchParams.set('api_key', apiKey);
    }

    const searchResp = await fetch(searchUrl.toString(), {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: 'application/json' },
    });

    if (searchResp.ok) {
      const searchData = (await searchResp.json()) as {
        esearchresult?: { idlist?: string[] };
      };
      const geneId = searchData.esearchresult?.idlist?.[0];

      if (geneId && /^\d+$/.test(geneId)) {
        const summaryUrl = new URL(`${NCBI_BASE_URL}/esummary.fcgi`);
        summaryUrl.searchParams.set('db', 'gene');
        summaryUrl.searchParams.set('id', geneId);
        summaryUrl.searchParams.set('retmode', 'json');
        if (apiKeyConfigured) {
          summaryUrl.searchParams.set('api_key', apiKey);
        }

        const summaryResp = await fetch(summaryUrl.toString(), {
          signal: AbortSignal.timeout(4000),
          headers: { Accept: 'application/json' },
        });

        if (summaryResp.ok) {
          const summaryData = (await summaryResp.json()) as {
            result?: Record<
              string,
              {
                name?: string;
                description?: string;
                chromosome?: string;
                maplocation?: string;
                summary?: string;
                organism?: { scientificname?: string };
              }
            >;
          };
          const record = summaryData.result?.[geneId];
          if (record) {
            return {
              symbol: record.name || cleanSymbol,
              organism: record.organism?.scientificname || allowedOrganism,
              ncbiGeneId: geneId,
              officialName: record.description || cleanSymbol,
              chromosome: record.chromosome || '-',
              mapLocation: record.maplocation || null,
              summary: record.summary || 'Retrieved from NCBI Entrez Gene database.',
              source: 'ncbi_live',
              apiKeyConfigured,
            };
          }
        }
      }
    }
  } catch {
    // Graceful fallback to local curated reference when external network is unreachable
  }

  const fallback =
    CURATED_GENE_REFERENCE[cleanSymbol] ||
    CURATED_GENE_REFERENCE[cleanSymbol.toUpperCase()];

  if (fallback) {
    return {
      ...fallback,
      source: 'local_reference',
      apiKeyConfigured,
    };
  }

  return {
    symbol: cleanSymbol,
    organism: allowedOrganism,
    ncbiGeneId: null,
    officialName: `${cleanSymbol} locus`,
    chromosome: '-',
    mapLocation: null,
    summary: 'External NCBI lookup unavailable offline; displaying local database symbol record.',
    source: 'local_reference',
    apiKeyConfigured,
  };
}
