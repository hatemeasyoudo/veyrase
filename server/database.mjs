import { rootCertificates } from 'node:tls';
import { Pool } from 'pg';

// The production CA from Supabase Dashboard → Database Settings → SSL Configuration.
const supabaseRootCertificate = `
-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`;

let database;

export function connectDatabase(connectionString) {
  if (!connectionString) return null;
  if (database) return database;
  const uri = new URL(connectionString);
  const host = uri.hostname.toLowerCase();
  const supabase = host.endsWith('.pooler.supabase.com') || /^db\.[a-z0-9-]+\.supabase\.co$/.test(host);
  let ssl;
  let sslnegotiation;
  if (supabase) {
    // TLS parameters in the URI otherwise overwrite the explicit pg SSL options.
    sslnegotiation = uri.searchParams.get('sslnegotiation') || undefined;
    for (const parameter of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslnegotiation']) {
      uri.searchParams.delete(parameter);
    }
    ssl = { ca: [...rootCertificates, supabaseRootCertificate], rejectUnauthorized: true };
  } else {
    uri.searchParams.set('sslmode', 'verify-full');
  }
  const pool = new Pool({
    connectionString: uri.href,
    ssl,
    sslnegotiation,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000
  });
  pool.on('error', error => console.error('Idle database connection error:', error.name));
  database = {
    query: (text, values) => pool.query(text, values),
    async transaction(operation) {
      const client = await pool.connect();
      let discard;
      try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
        throw error;
      } finally {
        client.release(discard);
      }
    }
  };
  return database;
}
