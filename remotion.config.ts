import {Config} from '@remotion/cli/config';
// The app uses NodeNext .js specifiers for TypeScript sources. Resolve those
// same shared renderer modules in Remotion's webpack bundle, without duplicating them.
Config.overrideWebpackConfig(config => ({
  ...config,
  resolve: {...config.resolve, extensionAlias: {...config.resolve?.extensionAlias, '.js': ['.js', '.ts', '.tsx']}},
}));
