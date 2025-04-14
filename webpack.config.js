const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: {
      background: './src/background.ts',
      popup: './src/popup/popup.ts',
      options: './src/options/options.ts',
      offscreen: './src/offscreen/offscreen.ts',
      content_script: './src/content_script.ts'
    },
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, 'dist'),
      clean: true, // Clean the output directory before each build
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/i,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
        {
          test: /\.html$/i,
          loader: 'html-loader',
          exclude: [/src\/popup\/popup\.html/, /src\/options\/options\.html/], // Corrected regex
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js']
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: 'manifest.json', to: '.' },
          { from: 'icons', to: 'icons' }, // Copy icons directory
          { from: 'src/offscreen/offscreen.html', to: '.' }, // Copy offscreen html
          { from: 'src/content_script.css', to: '.' }
        ],
      }),
      new HtmlWebpackPlugin({
        template: './src/popup/popup.html',
        filename: 'popup.html',
        chunks: ['popup'], // Include only the popup chunk
      }),
      new HtmlWebpackPlugin({
        template: './src/options/options.html',
        filename: 'options.html',
        chunks: ['options'], // Include only the options chunk
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
    ],
    devtool: isProduction ? false : 'cheap-module-source-map', // Source maps for development
    mode: isProduction ? 'production' : 'development',
    // optimization: {
    //   minimize: isProduction, // Minimize code in production
    // },
    performance: {
      hints: false, // Disable performance hints for large extension files
    },
  };
}; 