import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.codex.infoagent',
  appName: '个人信息管家',
  webDir: 'dist',
  backgroundColor: '#f5f6f8',
};

// 原生 App 加载哪个服务器：构建时通过环境变量指定
// 例如 macOS 上：CAP_SERVER_URL=https://你的域名 npx cap sync ios
if (process.env.CAP_SERVER_URL) {
  config.server = {
    url: process.env.CAP_SERVER_URL,
    cleartext: true,
  };
}

export default config;
