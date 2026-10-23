export type Metrics = {
  source: string;
  period: { start: string | null; end: string; timezone: string };
  visits: {
    source: 'daily_ip_uv';
    total: number;
    roles_source: 'mock';
    roles: Record<string, number>;
  };
  ai: {
    generated: number;
    adopted: number;
    published: number;
    adoption_rate: number | null;
    failed: number;
    degraded: number;
    risk_interceptions: number;
  };
  capacity_saved_minutes: number | null;
  scenarios: { equipment_failure: number; urgent_insertion: number };
  trend: { label: string; generated: number; published: number }[];
  limitations: string[];
};
