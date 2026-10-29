export interface VisitorPage {
  items: { visit_date: string; ip: string; matches_current_ip: boolean }[];
  total: number;
  page: number;
  page_size: number;
  current_ip: string | null;
}
