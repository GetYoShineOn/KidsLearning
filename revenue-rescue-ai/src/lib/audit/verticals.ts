// Vertical assumptions. EVERY number here is an ASSUMPTION used to produce ranges, not a measured fact.
// Ranges intentionally wide. Refine with evidence from docs/research/market-vertical-pricing.md and, above all,
// from real customer call/lead data. Values in whole USD.
export interface VerticalModel {
  label: string;
  jobValue: [number, number];      // average booked job value
  closeRate: [number, number];     // share of answered/engaged qualified leads that become jobs
  monthlyLeads: [number, number];  // typical inbound leads/month for a small-to-mid shop (calls + forms)
  emergency: boolean;              // urgent demand => speed matters more
}

export const VERTICALS: Record<string, VerticalModel> = {
  hvac:        { label: 'HVAC',             jobValue: [450, 6500],  closeRate: [0.25, 0.5],  monthlyLeads: [60, 250], emergency: true },
  plumbing:    { label: 'Plumbing',         jobValue: [300, 2500],  closeRate: [0.3, 0.55],  monthlyLeads: [60, 250], emergency: true },
  roofing:     { label: 'Roofing',          jobValue: [5000, 14000],closeRate: [0.1, 0.25],  monthlyLeads: [30, 120], emergency: false },
  electrical:  { label: 'Electrical',       jobValue: [250, 2500],  closeRate: [0.3, 0.5],   monthlyLeads: [40, 150], emergency: true },
  garage_door: { label: 'Garage doors',     jobValue: [250, 1500],  closeRate: [0.35, 0.6],  monthlyLeads: [40, 150], emergency: true },
  foundation:  { label: 'Foundation repair',jobValue: [4000, 12000],closeRate: [0.15, 0.3],  monthlyLeads: [15, 60],  emergency: false },
  restoration: { label: 'Water/fire restoration', jobValue: [3000, 10000], closeRate: [0.3, 0.6], monthlyLeads: [20, 80], emergency: true },
  remodeling:  { label: 'Remodeling',       jobValue: [8000, 45000],closeRate: [0.1, 0.25],  monthlyLeads: [15, 60],  emergency: false },
  landscaping: { label: 'Landscaping',      jobValue: [500, 5000],  closeRate: [0.2, 0.4],   monthlyLeads: [30, 120], emergency: false },
  pest_control:{ label: 'Pest control',     jobValue: [150, 700],   closeRate: [0.4, 0.65],  monthlyLeads: [60, 250], emergency: false },
  solar:       { label: 'Solar',            jobValue: [15000, 35000],closeRate: [0.05, 0.15],monthlyLeads: [20, 100], emergency: false },
  other:       { label: 'Other service business', jobValue: [300, 3000], closeRate: [0.2, 0.4], monthlyLeads: [30, 120], emergency: false },
};

export const INDUSTRY_KEYS = Object.keys(VERTICALS);
export function verticalFor(key: string): VerticalModel { return VERTICALS[key] ?? VERTICALS.other; }
