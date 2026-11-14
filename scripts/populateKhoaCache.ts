import { KHOA_TIDE_STATIONS } from '../src/utils/tideService';
import { fetchKhoaSwtcWeekly } from '../src/utils/khoaSwtcApi';
import { getSupabase } from '../src/utils/cloudDb';

async function main() {
  console.log(`Starting pre-population of ${KHOA_TIDE_STATIONS.length} KHOA tide stations...`);
  const now = new Date();
  const sb = getSupabase();
  let successCount = 0;
  let failCount = 0;

  for (const st of KHOA_TIDE_STATIONS) {
    try {
      console.log(`Fetching ${st.name} (${st.code})...`);
      const swtc = await fetchKhoaSwtcWeekly(st.code, now);
      if (swtc && swtc.days && swtc.days.length > 0) {
        successCount++;
        console.log(`  ✓ ${st.name}: ${swtc.days[0].events.length} events, High1=${swtc.days[0].events[0]?.time}`);
      } else {
        failCount++;
        console.warn(`  ✗ ${st.name}: no data`);
      }
      // Small pause to avoid hammering the server
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      failCount++;
      console.error(`  ✗ ${st.name} error:`, e);
    }
  }

  console.log(`\nCompleted! Success: ${successCount}, Fail: ${failCount}`);
  if (successCount === 0) {
    process.exitCode = 1;
    console.error('All station requests failed during cache population.');
  }
  const { count } = await sb.from('khoa_global_cache').select('*', { count: 'exact', head: true });
  console.log(`Total rows in Supabase khoa_global_cache: ${count}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
