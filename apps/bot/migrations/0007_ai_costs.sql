CREATE TABLE ai_costs (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  at TEXT NOT NULL,
  service TEXT NOT NULL,
  unit TEXT NOT NULL,
  amount_eur REAL NOT NULL CHECK (amount_eur >= 0),
  ref TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id, unit)
);
CREATE INDEX idx_ai_costs_month ON ai_costs (tenant_id, at);

CREATE TABLE ai_cost_notices (
  tenant_id TEXT NOT NULL,
  notice TEXT NOT NULL,
  PRIMARY KEY (tenant_id, notice)
);
