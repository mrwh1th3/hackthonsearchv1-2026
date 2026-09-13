import type { JsonObject } from './types';

// Presentation priority of the original trigger, never a probability of fraud.
const categories = [
  { id: 'combined', title: 'Combined signals', hint: 'More than one recorded trigger' },
  { id: 'listed', title: 'Listed suppliers', hint: 'Recorded list matches' },
  { id: 'approval', title: 'Approval thresholds', hint: 'Purchases near an approval limit' },
  { id: 'timing', title: 'Revenue timing', hint: 'Period-end revenue checks' },
  { id: 'new', title: 'New suppliers', hint: 'Recent registration checks' },
  { id: 'bank', title: 'Shared-bank coincidences', hint: 'A shared bank alone does not establish a transfer' },
  { id: 'other', title: 'Other signals', hint: 'Unranked recorded triggers' },
];
export function groupClosedLeads(leads: JsonObject[]) {
  const buckets = categories.map(category => ({ ...category, leads: [] as JsonObject[] }));
  for (const lead of leads) {
    const signals = [...new Set(String(lead.signal ?? '').split(',').map(s => s.trim()).filter(Boolean))];
    const id = signals.length > 1 ? 'combined' : signals.includes('efos_list_match') ? 'listed' : signals.includes('po_below_approval_limit') ? 'approval' : signals.includes('quarter_end_revenue') ? 'timing' : signals.includes('recently_registered_vendor') ? 'new' : signals.includes('employee_vendor_shared_bank') ? 'bank' : 'other';
    buckets.find(bucket => bucket.id === id)!.leads.push(lead);
  }
  return buckets.filter(bucket => bucket.leads.length);
}
