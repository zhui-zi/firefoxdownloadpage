export async function onRequest(context) {
  // Mozilla 官方下载链接
  const sourceUrl = "https://download.mozilla.org/?product=fenix-latest&os=android&lang=zh-CN";

  // 1. 发起请求 (由 Cloudflare 服务器代劳)
  const response = await fetch(sourceUrl, {
    headers: {
      // 模拟安卓设备，防止被跳转到 Google Play 页面
      'User-Agent': 'Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/109.0 Firefox/123.0'
    },
    redirect: 'follow' // 跟随重定向直到拿到 APK
  });

  // 2. 重新构建响应头，确保浏览器识别为文件下载
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Content-Disposition', 'attachment; filename="Firefox-Android-Latest.apk"');
  newHeaders.set('Content-Type', 'application/vnd.android.package-archive');
  
  // 删除可能导致跨域或其他问题的头
  newHeaders.delete('Content-Length'); 

  // 3. 返回文件流
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}
