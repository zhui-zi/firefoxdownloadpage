export async function onRequest(context) {
  try {
    // ============================================================
    // 第一步：获取版本列表
    // ============================================================
    // 直接访问 Mozilla 的 Fenix (Firefox Android) 归档目录
    const releasesUrl = "https://archive.mozilla.org/pub/fenix/releases/";
    
    // 获取目录的 HTML 页面
    const listResponse = await fetch(releasesUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Cloudflare-Worker)' }
    });

    if (!listResponse.ok) {
      return new Response(`无法连接到 Mozilla 归档服务器: ${listResponse.status}`, { status: 502 });
    }

    const listHtml = await listResponse.text();

    // 使用正则提取所有以数字开头的版本号文件夹 (例如 "123.0.1/")
    // 排除 beta, nightly 等非纯数字版本
    const versionRegex = /href="(\d+\.\d+(\.\d+)?)\/"/g;
    const versions = [];
    let match;
    while ((match = versionRegex.exec(listHtml)) !== null) {
      versions.push(match[1]); // 拿到版本号字符串，如 "120.0.1"
    }

    if (versions.length === 0) {
      return new Response("未在归档目录中找到任何有效版本。", { status: 404 });
    }

    // ============================================================
    // 第二步：找出最大的版本号
    // ============================================================
    // 简单的字符串排序是不够的 (因为 "10.0" < "2.0")，需要按数值段比较
    const sortedVersions = versions.sort((a, b) => {
      const partsA = a.split('.').map(Number);
      const partsB = b.split('.').map(Number);
      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const valA = partsA[i] || 0;
        const valB = partsB[i] || 0;
        if (valA !== valB) return valA - valB;
      }
      return 0;
    });

    const latestVersion = sortedVersions.pop(); // 取最后一个，即最大版本

    // ============================================================
    // 第三步：定位 APK 文件
    // ============================================================
    // 构造该版本 arm64 架构的具体目录 URL
    // 路径规则通常是: /releases/<ver>/android/fenix-<ver>-android-arm64-v8a/
    const apkDirUrl = `${releasesUrl}${latestVersion}/android/fenix-${latestVersion}-android-arm64-v8a/`;

    // 再次请求这个目录，为了获取准确的文件名 (防止文件名里有额外的 build ID)
    const apkListResponse = await fetch(apkDirUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Cloudflare-Worker)' }
    });

    if (!apkListResponse.ok) {
       // 备用方案：如果特定架构目录找不着，可能路径规则微调了，尝试直接盲猜文件名
       // 但通常这一步能成功。如果失败，返回错误以便调试。
       return new Response(`找到版本 ${latestVersion} 但无法进入其下载目录。`, { status: 404 });
    }

    const apkDirHtml = await apkListResponse.text();

    // 查找 .apk 结尾的文件链接
    // 通常文件名类似: fenix-123.0.0.multi.android-arm64-v8a.apk
    const apkFileRegex = /href="([^"]+\.apk)"/;
    const fileMatch = apkDirHtml.match(apkFileRegex);

    if (!fileMatch) {
      return new Response(`在版本 ${latestVersion} 中未找到 APK 文件。`, { status: 404 });
    }

    const apkFilename = fileMatch[1];
    const finalDownloadUrl = `${apkDirUrl}${apkFilename}`;

    // ============================================================
    // 第四步：代理下载
    // ============================================================
    const fileResponse = await fetch(finalDownloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Android) Gecko/100.0 Firefox/100.0',
      },
      redirect: 'follow'
    });

    const newHeaders = new Headers(fileResponse.headers);
    newHeaders.set('Content-Disposition', `attachment; filename="Firefox-Android-${latestVersion}.apk"`);
    newHeaders.set('Content-Type', 'application/vnd.android.package-archive');
    newHeaders.delete('Content-Length'); // 避免流传输中断

    return new Response(fileResponse.body, {
      status: fileResponse.status,
      statusText: fileResponse.statusText,
      headers: newHeaders
    });

  } catch (error) {
    return new Response(`服务器内部错误: ${error.message}\nStack: ${error.stack}`, { status: 500 });
  }
}
