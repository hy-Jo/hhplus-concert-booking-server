const fs = require('fs');
const files = [
  'load-tests/results/01-queue-spike-small.json',
  'load-tests/results/01-queue-spike-medium.json',
  'load-tests/results/02-reservation-stress-small.json',
  'load-tests/results/02-reservation-stress-medium.json',
  'load-tests/results/03-payment-load-small.json',
  'load-tests/results/03-payment-load-medium.json',
  'load-tests/results/04-concert-endurance-small.json',
  'load-tests/results/04-concert-endurance-medium.json',
];

function fmt(v) {
  if (v == null) return 'N/A';
  return v.toFixed(2) + 'ms';
}

for (const f of files) {
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const m = data.metrics || {};
    console.log('');
    console.log('=== ' + f + ' ===');
    if (m.http_reqs) {
      console.log('  http_reqs.count: ' + m.http_reqs.values.count);
      console.log('  http_reqs.rate: ' + m.http_reqs.values.rate.toFixed(2) + '/s');
    }
    if (m.http_req_duration) {
      const v = m.http_req_duration.values;
      console.log('  duration avg: ' + fmt(v.avg));
      console.log('  duration p90: ' + fmt(v['p(90)']));
      console.log('  duration p95: ' + fmt(v['p(95)']));
      console.log('  duration p99: ' + fmt(v['p(99)']));
    }
    if (m.http_req_failed) {
      console.log('  http_req_failed.rate: ' + (m.http_req_failed.values.rate * 100).toFixed(4) + '%');
    }
    if (m.errors) {
      console.log('  errors.rate: ' + (m.errors.values.rate * 100).toFixed(4) + '%');
    }
    for (const name of Object.keys(m)) {
      const metric = m[name];
      if (metric.thresholds) {
        for (const thName of Object.keys(metric.thresholds)) {
          const ok = metric.thresholds[thName].ok === true;
          console.log('  threshold [' + (ok ? 'PASS' : 'FAIL') + '] ' + name + ': ' + thName);
        }
      }
    }
    const counters = ['token_issue_success','token_issue_failed','reservation_success','reservation_conflict','reservation_failed','payment_success','payment_failed','insufficient_points','cache_hit_count','cache_miss'];
    for (const c of counters) {
      if (m[c]) console.log('  ' + c + ': ' + m[c].values.count);
    }
    if (m.cache_hit) console.log('  cache_hit.rate: ' + (m.cache_hit.values.rate * 100).toFixed(2) + '%');
  } catch(e) {
    console.log('  ERROR: ' + e.message);
  }
}