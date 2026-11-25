-- =====================================================================
--  GENETIC LINEAGE & CRISPR OFF-TARGET MUTATION TRACKER
--  MySQL 8.0+ Complete Schema, Triggers, Views, Procedures & Seed Data
-- =====================================================================

DROP DATABASE IF EXISTS crispr_tracker;
CREATE DATABASE crispr_tracker;
USE crispr_tracker;

-- =====================================================================
-- PART 1 : DDL  (tables, PK, FK, CHECK, UNIQUE, DEFAULT)
-- =====================================================================

CREATE TABLE organism (
    organism_id     INT AUTO_INCREMENT PRIMARY KEY,
    common_name     VARCHAR(40) NOT NULL,
    scientific_name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE lab (
    lab_id     INT AUTO_INCREMENT PRIMARY KEY,
    lab_name   VARCHAR(60) NOT NULL UNIQUE,
    department VARCHAR(60) NOT NULL
);

CREATE TABLE researcher (
    researcher_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name     VARCHAR(60) NOT NULL,
    email         VARCHAR(80) NOT NULL UNIQUE,
    lab_id        INT NOT NULL,
    FOREIGN KEY (lab_id) REFERENCES lab(lab_id)
);

CREATE TABLE app_user (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    full_name     VARCHAR(80) NOT NULL,
    email         VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('admin','researcher') NOT NULL DEFAULT 'researcher',
    lab_id        INT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lab_id) REFERENCES lab(lab_id)
);

CREATE TABLE cas_variant (
    cas_id       INT AUTO_INCREMENT PRIMARY KEY,
    variant_name VARCHAR(30) NOT NULL UNIQUE,
    pam_motif    VARCHAR(15) NOT NULL,
    fidelity     ENUM('Standard','High') NOT NULL
);

CREATE TABLE detection_method (
    method_id      INT AUTO_INCREMENT PRIMARY KEY,
    method_name    VARCHAR(40) NOT NULL UNIQUE,
    is_genome_wide BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE gene (
    gene_id     INT AUTO_INCREMENT PRIMARY KEY,
    gene_symbol VARCHAR(20) NOT NULL,
    organism_id INT NOT NULL,
    chromosome  VARCHAR(5)  NOT NULL,
    gene_type   ENUM('tumor_suppressor','oncogene','other') NOT NULL DEFAULT 'other',
    UNIQUE (gene_symbol, organism_id),
    FOREIGN KEY (organism_id) REFERENCES organism(organism_id)
);

CREATE TABLE guide_rna (
    guide_id        INT AUTO_INCREMENT PRIMARY KEY,
    guide_name      VARCHAR(30) NOT NULL UNIQUE,
    spacer_seq      CHAR(20) NOT NULL,
    pam_seq         VARCHAR(6) NOT NULL,
    target_gene_id  INT NOT NULL,
    on_target_score DECIMAL(4,1) CHECK (on_target_score BETWEEN 0 AND 100),
    CHECK (CHAR_LENGTH(spacer_seq) = 20),
    FOREIGN KEY (target_gene_id) REFERENCES gene(gene_id)
);

CREATE TABLE experiment (
    experiment_id INT AUTO_INCREMENT PRIMARY KEY,
    title         VARCHAR(80) NOT NULL,
    researcher_id INT NOT NULL,
    cas_id        INT NOT NULL,
    start_date    DATE NOT NULL,
    FOREIGN KEY (researcher_id) REFERENCES researcher(researcher_id),
    FOREIGN KEY (cas_id)        REFERENCES cas_variant(cas_id)
);

CREATE TABLE experiment_guide (
    experiment_id INT,
    guide_id      INT,
    PRIMARY KEY (experiment_id, guide_id),
    FOREIGN KEY (experiment_id) REFERENCES experiment(experiment_id),
    FOREIGN KEY (guide_id)      REFERENCES guide_rna(guide_id)
);

CREATE TABLE sample (
    sample_id        INT AUTO_INCREMENT PRIMARY KEY,
    sample_code      VARCHAR(30) NOT NULL UNIQUE,
    cell_line        VARCHAR(30) NOT NULL,
    organism_id      INT NOT NULL,
    experiment_id    INT NOT NULL,
    parent_sample_id INT NULL,
    generation       INT NOT NULL DEFAULT 0,
    created_date     DATE NOT NULL,
    status           ENUM('active','frozen','discarded') NOT NULL DEFAULT 'active',
    notes            VARCHAR(200) NULL,
    FOREIGN KEY (organism_id)      REFERENCES organism(organism_id),
    FOREIGN KEY (experiment_id)    REFERENCES experiment(experiment_id),
    FOREIGN KEY (parent_sample_id) REFERENCES sample(sample_id)
);

CREATE TABLE off_target_site (
    site_id        INT AUTO_INCREMENT PRIMARY KEY,
    guide_id       INT NOT NULL,
    chromosome     VARCHAR(5) NOT NULL,
    position       BIGINT NOT NULL,
    mismatch_count TINYINT NOT NULL CHECK (mismatch_count BETWEEN 1 AND 5),
    region_type    ENUM('exon','intron','intergenic') NOT NULL,
    gene_id        INT NULL,
    FOREIGN KEY (guide_id) REFERENCES guide_rna(guide_id),
    FOREIGN KEY (gene_id)  REFERENCES gene(gene_id)
);

CREATE TABLE mutation_event (
    event_id      INT AUTO_INCREMENT PRIMARY KEY,
    sample_id     INT NOT NULL,
    site_id       INT NOT NULL,
    mutation_type ENUM('SNV','insertion','deletion','indel') NOT NULL,
    allele_freq   DECIMAL(5,2) NOT NULL CHECK (allele_freq BETWEEN 0 AND 100),
    detected_on   DATE NOT NULL,
    method_id     INT NOT NULL,
    FOREIGN KEY (sample_id) REFERENCES sample(sample_id),
    FOREIGN KEY (site_id)   REFERENCES off_target_site(site_id),
    FOREIGN KEY (method_id) REFERENCES detection_method(method_id)
);

CREATE TABLE alert_log (
    alert_id   INT AUTO_INCREMENT PRIMARY KEY,
    event_id   INT NOT NULL,
    message    VARCHAR(150) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES mutation_event(event_id)
);

CREATE INDEX idx_event_sample ON mutation_event(sample_id);
CREATE INDEX idx_event_site   ON mutation_event(site_id);
CREATE INDEX idx_event_freq   ON mutation_event(allele_freq);
CREATE INDEX idx_site_guide   ON off_target_site(guide_id);

-- =====================================================================
-- PART 2 : TRIGGERS & FUNCTION
-- =====================================================================
DELIMITER //

CREATE TRIGGER trg_sample_generation
BEFORE INSERT ON sample
FOR EACH ROW
BEGIN
    IF NEW.parent_sample_id IS NULL THEN
        SET NEW.generation = 0;
    ELSE
        SET NEW.generation = (SELECT generation + 1 FROM sample
                              WHERE sample_id = NEW.parent_sample_id);
    END IF;
END//

CREATE TRIGGER trg_high_freq_alert
AFTER INSERT ON mutation_event
FOR EACH ROW
BEGIN
    IF NEW.allele_freq >= 5 THEN
        INSERT INTO alert_log(event_id, message)
        VALUES (NEW.event_id,
                CONCAT('High off-target frequency (', NEW.allele_freq, '%) in sample ', NEW.sample_id));
    END IF;
END//

CREATE FUNCTION fn_risk_level(p_freq DECIMAL(5,2), p_region VARCHAR(20), p_gene_type VARCHAR(20))
RETURNS VARCHAR(10) DETERMINISTIC
BEGIN
    IF p_freq >= 5
       OR (p_region = 'exon' AND p_gene_type IN ('tumor_suppressor','oncogene')) THEN
        RETURN 'HIGH';
    ELSEIF p_freq >= 1 THEN
        RETURN 'MEDIUM';
    ELSE
        RETURN 'LOW';
    END IF;
END//

DELIMITER ;

-- =====================================================================
-- PART 3 : SAMPLE DATA
-- =====================================================================
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
('GUIDE-seq', TRUE), ('Digenome-seq', TRUE),
('Targeted amplicon NGS', FALSE), ('T7E1 assay', FALSE);

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

-- =====================================================================
-- PART 4 : VIEWS & STORED PROCEDURE
-- =====================================================================

CREATE VIEW v_offtarget_report AS
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
       fn_risk_level(e.allele_freq, o.region_type, og.gene_type) AS risk_level
FROM mutation_event e
JOIN sample s            ON s.sample_id     = e.sample_id
JOIN experiment x        ON x.experiment_id = s.experiment_id
JOIN off_target_site o   ON o.site_id       = e.site_id
JOIN guide_rna g         ON g.guide_id      = o.guide_id
JOIN detection_method m  ON m.method_id     = e.method_id
LEFT JOIN gene og        ON og.gene_id      = o.gene_id;

CREATE VIEW v_high_risk_events AS
SELECT * FROM v_offtarget_report WHERE risk_level = 'HIGH';

CREATE VIEW v_experiment_summary AS
SELECT x.experiment_id,
       x.title,
       r.full_name  AS researcher,
       c.variant_name AS cas_variant,
       c.fidelity,
       COUNT(DISTINCT s.sample_id) AS total_samples,
       COUNT(e.event_id)           AS total_mutations,
       IFNULL(MAX(e.allele_freq),0)           AS max_freq,
       IFNULL(ROUND(AVG(e.allele_freq),2),0)  AS avg_freq
FROM experiment x
JOIN researcher r   ON r.researcher_id = x.researcher_id
JOIN cas_variant c  ON c.cas_id        = x.cas_id
LEFT JOIN sample s  ON s.experiment_id = x.experiment_id
LEFT JOIN mutation_event e ON e.sample_id = s.sample_id
GROUP BY x.experiment_id, x.title, r.full_name, c.variant_name, c.fidelity;

UPDATE sample SET notes = 'Needs re-sequencing'
WHERE sample_code IN (SELECT DISTINCT sample_code FROM (SELECT sample_code FROM v_high_risk_events) AS hr);

DELIMITER //
CREATE PROCEDURE sp_experiment_report(IN p_exp INT)
BEGIN
    SELECT sample_code, guide_name, hit_gene, mutation_type, allele_freq, risk_level
    FROM v_offtarget_report
    WHERE experiment_id = p_exp
    ORDER BY allele_freq DESC;
END//
DELIMITER ;
