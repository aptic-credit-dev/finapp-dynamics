/**
 * Stage-7 AUTHENTICATED load harness SAFETY self-test. Verifies guards + the pure cookie/metric helpers
 * WITHOUT needing the API (the config-rejection cases target dead loopback and never send auth). Exits
 * non-zero on any failure. No network login is performed here — a live authenticated run happens only on the
 * staging host against 127.0.0.1.
 */
import {
  parseSetCookie,
  cookieHeader,
  isLoopbackTarget,
  loadEnabled,
  runAuthLoad,
} from './auth-load-harness.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

// production refusal
{
  const save = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  check('production_disabled', loadEnabled() === false);
  let threw = false;
  try {
    await runAuthLoad({ url: 'http://127.0.0.1:3000', cookie: 'x=y', concurrency: 1, durationMs: 10 });
  } catch {
    threw = true;
  }
  check('production_refusal_throws', threw);
  process.env.NODE_ENV = save ?? 'staging';
}

// non-loopback target refusal
{
  process.env.NODE_ENV = 'staging';
  check('rejects_external_target', isLoopbackTarget('http://169.58.194.151:3000') === false);
  check('accepts_loopback_ip', isLoopbackTarget('http://127.0.0.1:3000') === true);
  let threw = false;
  try {
    await runAuthLoad({ url: 'http://example.com', cookie: 'x=y', concurrency: 1, durationMs: 10 });
  } catch {
    threw = true;
  }
  check('external_target_throws', threw);
}

// write mode requires writeType
{
  process.env.NODE_ENV = 'staging';
  let threw = false;
  try {
    await runAuthLoad({
      url: 'http://127.0.0.1:3000',
      cookie: 'x=y',
      mode: 'write',
      concurrency: 1,
      durationMs: 10,
    });
  } catch {
    threw = true;
  }
  check('write_mode_requires_write_type', threw);
}

// cookie parsing / serialization
{
  const jar = parseSetCookie([
    'finapp_session=abc123; Path=/; HttpOnly; SameSite=Lax',
    'finapp_csrf=tok987; Path=/; SameSite=Lax',
    'finapp_refresh=ref555; Path=/api/v1/auth/session/refresh; HttpOnly',
  ]);
  check('parse_session', jar.finapp_session === 'abc123', `got=${jar.finapp_session}`);
  check('parse_csrf', jar.finapp_csrf === 'tok987');
  check('parse_refresh', jar.finapp_refresh === 'ref555');
  check('parse_empty_null_safe', Object.keys(parseSetCookie(undefined)).length === 0);
  const header = cookieHeader({ finapp_session: 'abc123', finapp_csrf: 'tok987' });
  check('cookie_header_join', header === 'finapp_session=abc123; finapp_csrf=tok987', header);
}

console.log(`AUTH LOAD HARNESS SAFETY SELF-TEST — failures=${failed}`);
process.exit(failed > 0 ? 1 : 0);
