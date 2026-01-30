export async function onRequest(context) {
  try {
    // 1. 获取 Mozilla 官方的版本信息 JSON (这是静态文件，无速率限制)
    // 这里的 mobile_versions.json 包含了安卓版的最新版本号
    const versionUrl = "https://product-details.mozilla.org/1.0/mobile_versions.json";
    
    const versionResponse = await fetch(versionUrl, {
      headers: { 'User-Agent': 'Cloudflare-Workers-Firefox-Proxy' }
    });

    if (!versionResponse.ok) {
      throw new Error(`Mozilla Version API Error: ${versionResponse.status}`);
    }

    const versions = await versionResponse.json();
    
    // 2. 提取最新的 Android 正式版版本号
    // 通常 key 是 "alpha" / "beta" / "nightly" / "version"
    // 我们找最新的 release 版本。或者使用 firefox_versions.json 中的 LATEST_FIREFOX_ANDROID_VERSION
    // 为保险起见，我们换用更通用的 firefox_versions.json
    const v2Url = "https://product-details.mozilla.org/1.0/firefox_versions.json";
    const v2Resp = await fetch(v2Url);
    const v2Json = await v2Resp.json();
    
    const latestVersion = v2Json.LATEST_FIREFOX_ANDROID_VERSION;

    if (!latestVersion) {
      return new Response("无法获取最新版本号", { status: 500 });
    }

    // 3. 构造 Mozilla Archive (归档服务器) 的直接下载链接
    // 路径规则: /pub/fenix/releases/<版本号>/android/fenix-<版本号>-android-arm64-v8a/fenix-<版本号>.multi.android-arm64-v8a.apk
    // "fenix" 是 Firefox Android 的内部代号
    const downloadUrl = `https://archive.mozilla.org/pub/fenix/releases/${latestVersion}/android/fenix-${latestVersion}-android-arm64-v8a/fenix-${latestVersion}.multi.android-arm64-v8a.apk`;
    
    const fileName = `Firefox-Android-${latestVersion}.apk`;

    // 4. 代理下载 (Cloudflare -> Mozilla Archive -> 用户)
    const fileResponse = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Android) Gecko/100.0 Firefox/100.0',
      },
      redirect: 'follow'
    });

    if (!fileResponse.ok) {
      // 如果 arm64 路径不对，可能是版本命名规则微调，尝试通用路径或报错
      // 但 standard release 结构非常固定，通常不会错
      return new Response(`文件下载失败 (Mozilla Archive): ${fileResponse.status}`, { status: 404 });
    }

    // 5. 返回文件流
    const newHeaders = new Headers(fileResponse.headers);
    newHeaders.set('Content-Disposition', `attachment; filename="${fileName}"`);
    newHeaders.set('Content-Type', 'application/vnd.android.package-archive');
    newHeaders.delete('Content-Length'); // 避免流传输中断

    return new Response(fileResponse.body, {
      status: fileResponse.status,
      statusText: fileResponse.statusText,
      headers: newHeaders
    });

  } catch (error) {
    return new Response(`服务器内部错误: ${error.message}`, { status: 500 });
  }
}
