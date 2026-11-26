// The shared web code reads its config as Vite does: import.meta.env.VITE_X.
// Metro has no import.meta, so those reads are rewritten at build time:
//   import.meta.env.VITE_X  ->  process.env.EXPO_PUBLIC_X   (inlined by Expo from .env)
//   import.meta.env.DEV     ->  __DEV__
//   import.meta.env.PROD    ->  !__DEV__
function viteEnv({ types: t }) {
  return {
    name: 'vite-env-to-expo',
    visitor: {
      MemberExpression(path) {
        const { node } = path;
        const obj = node.object;
        const isEnv = t.isMemberExpression(obj) && t.isMetaProperty(obj.object)
          && obj.object.meta.name === 'import' && obj.object.property.name === 'meta'
          && t.isIdentifier(obj.property, { name: 'env' });
        if (!isEnv || node.computed || !t.isIdentifier(node.property)) return;
        const key = node.property.name;
        if (key === 'DEV') path.replaceWith(t.identifier('__DEV__'));
        else if (key === 'PROD') path.replaceWith(t.unaryExpression('!', t.identifier('__DEV__')));
        else if (key.startsWith('VITE_')) {
          path.replaceWith(t.memberExpression(
            t.memberExpression(t.identifier('process'), t.identifier('env')),
            t.identifier('EXPO_PUBLIC_' + key.slice(5)),
          ));
        } else path.replaceWith(t.identifier('undefined'));
      },
    },
  };
}

module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'], plugins: [viteEnv] };
};
