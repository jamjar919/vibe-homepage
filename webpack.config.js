const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (_, argv = {}) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: path.resolve(__dirname, 'src/server.ts'),
    target: 'node',
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? 'source-map' : 'inline-source-map',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'server.js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: 'ts-loader',
            options: {
              transpileOnly: !isProduction,
            },
          },
        },
      ],
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'public/index.html'),
            to: path.resolve(__dirname, 'dist/index.html'),
          },
        ],
      }),
    ],
    externalsPresets: { node: true },
    infrastructureLogging: { level: 'error' },
    stats: 'minimal',
    ignoreWarnings: [
      {
        module: /express[\\/]+lib[\\/]+view\.js/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ],
  };
};
