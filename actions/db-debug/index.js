/**
 * DB Debug - Simple debug endpoint for App Builder Database
 * Returns a minimal status message. Extend with DB checks if needed.
 */
async function main(params) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: {
      status: 'ok',
      message: 'DB debug endpoint',
      timestamp: new Date().toISOString()
    }
  };
}

exports.main = main;
