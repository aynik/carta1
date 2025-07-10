import path from 'path'
import TerserPlugin from 'terser-webpack-plugin'

// Configuration for multiple builds
const builds = [
  {
    entry: './codec/index.js',
    output: {
      path: path.resolve('dist'),
      filename: 'carta1.min.js',
      library: 'Carta1',
      libraryTarget: 'umd',
      globalObject: 'this',
    },
  },
  {
    entry: './codec/browser/worker.js',
    output: {
      path: path.resolve('dist'),
      filename: 'carta1-worker.min.js',
      libraryTarget: 'self',
    },
  },
  {
    entry: './codec/browser/interface.js',
    output: {
      path: path.resolve('dist'),
      filename: 'carta1-worker-interface.min.js',
      library: 'Carta1Worker',
      libraryTarget: 'umd',
      globalObject: 'this',
    },
  },
]

export default builds.map(({ entry, output }) => ({
  mode: 'production',
  entry,
  output,
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
      }),
    ],
  },
  devtool: 'source-map',
}))
