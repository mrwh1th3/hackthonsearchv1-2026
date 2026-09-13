import { describe, it, expect } from 'vitest';
import { groupClosedLeads } from './closed-leads';
describe('closed lead presentation priority', () => {
  it('keeps all evidence and puts combined and list signals before routine coincidences', () => {
    const leads = ['employee_vendor_shared_bank','recently_registered_vendor','efos_list_match','efos_list_match, recently_registered_vendor','unknown'].map(signal => ({ signal, reason: 'Closed after checks' }));
    const groups = groupClosedLeads(leads);
    expect(groups.map(g => g.id)).toEqual(['combined','listed','new','bank','other']);
    expect(groups.flatMap(g => g.leads)).toHaveLength(leads.length);
    expect(groups[0].leads[0]).toBe(leads[3]);
  });
  it('does not count duplicate triggers as combined and preserves repeated checks', () => {
    const leads = [{ signal: 'efos_list_match, efos_list_match' }, { signal: 'efos_list_match' }];
    expect(groupClosedLeads(leads)).toMatchObject([{ id: 'listed', leads }]);
    expect(groupClosedLeads([])).toEqual([]);
  });
});
