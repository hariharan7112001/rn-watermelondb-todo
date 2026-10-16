module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // WatermelonDB models use decorators like @text and @field
    plugins: [['@babel/plugin-proposal-decorators', { legacy: true }]],
  };
};
