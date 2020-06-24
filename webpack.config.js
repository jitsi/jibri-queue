/* global __dirname */

const path = require('path');

module.exports = {
    mode: 'development',
    entry: './src/index.js',
    target: 'node',
    module: {
        rules: [
            { test: /\.js$/,
                exclude: /node_modules/,
                loader: 'babel-loader' }
        ]
    },
    output: {
        filename: 'main.js',
        path: path.resolve(__dirname, 'dist')
    }
};
