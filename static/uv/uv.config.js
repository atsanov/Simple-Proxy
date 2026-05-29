self.__uv$config = {
  prefix: '/uv/',
  encodeUrl: str => encodeURIComponent(str),
  decodeUrl: str => decodeURIComponent(str),
  handler: '/uv/uv.handler.js', bundle: '/uv/uv.bundle.js', config: '/uv/uv.config.js', sw: '/uv/uv.sw.js',
  forceHttps: true, requestMiddleware: [], responseMiddleware: [], block: []
};