const {createProxyMiddleware} = require("http-proxy-middleware");

module.exports = function(app) {
  app.use(
    "/api/yiban",
    createProxyMiddleware({
      target: "https://yiban.io",
      changeOrigin: true,
      pathRewrite: {"^/api/yiban": "/api"},
    }),
  );
  app.use(
    "/api/agnes",
    createProxyMiddleware({
      target: "https://apihub.agnes-ai.com",
      changeOrigin: true,
      pathRewrite: {"^/api/agnes": ""},
    }),
  );
};
