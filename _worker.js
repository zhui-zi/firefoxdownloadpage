export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 监听 /download 路径
    if (url.pathname === "/download") {
      // Mozilla 官方提供的"最新版"下载接口
      // product=fenix-latest 指向最新的 Firefox Android (Fenix)
      // os=android 指向安卓版
      // lang=zh-CN 确保下载的是中文版
      const sourceUrl = "https://download.mozilla.org/?product=fenix-latest&os=android&lang=zh-CN";

      // 1. 发起请求获取目标文件 (在 Cloudflare 服务器上执行，速度极快且无视墙)
      const response = await fetch(sourceUrl, {
        headers: {
          // 伪装 User-Agent，防止被重定向到 Play Store 页面
          'User-Agent': 'Mozilla/5.0 (Android) Gecko/123.0 Firefox/123.0' 
        },
        redirect: 'follow' // 跟随 Mozilla 的重定向直到获取到最终 APK 文件
      });

      // 2. 创建一个新的响应，将 Mozilla 的文件流直接返回给用户
      const newResponse = new Response(response.body, response);

      // 3. 强制设置下载文件名 (可选，为了体验更好)
      // 如果不设置，浏览器通常也能识别，但这样更保险
      newResponse.headers.set('Content-Disposition', 'attachment; filename="Firefox-Android-Latest.apk"');
      newResponse.headers.set('Content-Type', 'application/vnd.android.package-archive');

      return newResponse;
    }

    // 对于其他路径（如访问主页），直接返回静态资源
    return env.ASSETS.fetch(request);
  }
};
