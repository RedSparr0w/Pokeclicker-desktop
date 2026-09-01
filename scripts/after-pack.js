'use strict';

const path = require('node:path');
const {
  FuseV1Options,
  FuseVersion,
  flipFuses,
} = require('@electron/fuses');

function getElectronPath(context) {
  const { appOutDir, electronPlatformName, packager } = context;

  if (electronPlatformName === 'darwin' || electronPlatformName === 'mas') {
    const executableName = packager.appInfo.productFilename;
    return path.join(
      appOutDir,
      `${executableName}.app`,
      'Contents',
      'MacOS',
      executableName,
    );
  }
  if (electronPlatformName === 'linux') {
    return path.join(appOutDir, packager.executableName);
  }
  if (electronPlatformName === 'win32') {
    return path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
  }

  throw new Error(`Unsupported Electron platform: ${electronPlatformName}`);
}

exports.default = async function afterPack(context) {
  const electronPath = getElectronPath(context);
  const isDarwin = ['darwin', 'mas'].includes(context.electronPlatformName);

  // Use the directly pinned fuse library. electron-builder carries its own
  // version, which can lag behind a newly released Electron fuse wire.
  await flipFuses(electronPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: isDarwin,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    [FuseV1Options.WasmTrapHandlers]: true,
  });
};

exports.getElectronPath = getElectronPath;
