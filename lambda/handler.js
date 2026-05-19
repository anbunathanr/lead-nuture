// legacy handler — see api-handler.js for the full implementation
exports.handler = async () => ({ statusCode: 301, headers: { Location: '/' }, body: '' });
