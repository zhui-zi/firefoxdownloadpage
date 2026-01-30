export async function onRequest(context) {
  // 1. 设置 GitHub API 地址
  const releasesUrl = "https://api.github.com/repos/mozilla-mobile/firefox-android/releases";
  
  try {
    // 2. 请求 GitHub API 获取发布列表
    const apiResponse = await fetch(releasesUrl, {
      headers: {
        'User-Agent': 'Cloudflare-Workers-Firefox-Proxy', // GitHub 要求必须有 UA
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!apiResponse.ok) {
      throw new Error(`GitHub API Error: ${apiResponse.status}`);
    }

    const releases = await apiResponse.json();

    // 3. 筛选最新的正式版 (排除 pre-release/beta)
    // 并且该版本必须包含 arm64-v8a 的 apk 文件
    const latestRelease = releases.find(release => 
      !release.prerelease && 
      release.assets.some(asset => 
        asset.name.includes('arm64-v8a') && 
        asset.name.endsWith('.apk') &&
        asset.name.includes('fenix') // fenix 是 Firefox 安卓版的代号
      )
    );

    if (!latestRelease) {
      return new Response("未找到最新的正式版 APK，请稍后再试。", { status: 404 });
    }

    // 4. 提取下载链接和文件名
    const asset = latestRelease.assets.find(a => 
      a.name.includes('arm64-v8a') && 
      a.name.endsWith('.apk') && 
      a.name.includes('fenix')
    );
    
    const downloadUrl = asset.browser_download_url;
    const fileName = asset.name;

    // 5. 开始代理下载 (从 GitHub 下载流转发给用户)
    // 这样用户连接的是 Cloudflare，由 Cloudflare 去连接 GitHub，解决墙的问题
    const fileResponse = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Cloudflare-Workers-Firefox-Proxy'
      },
      redirect: 'follow'
    });

    // 6. 组装响应头，强制浏览器下载文件
    const newHeaders = new Headers(fileResponse.headers);
    newHeaders.set('Content-Disposition', `attachment; filename="${fileName}"`);
    newHeaders.set('Content-Type', 'application/vnd.android.package-archive');
    
    // 删除 Content-Length，因为流式传输可能不准确，避免下载中断
    newHeaders.delete('Content-Length');

    return new Response(fileResponse.body, {
      status: fileResponse.status,
      statusText: fileResponse.statusText,
      headers: newHeaders
    });

  } catch (error) {
    return new Response(`服务器内部错误: ${error.message}`, { status: 500 });
  }
}
