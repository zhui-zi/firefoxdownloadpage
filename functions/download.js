export async function onRequest(context) {
  // ============================================================
  // 配置区域
  // ============================================================
  // 紧急备用版本号：如果所有自动获取都失败了，就用这个。
  // 根据最新数据，2026年初 Firefox Android 版本约为 147.0
  const EMERGENCY_VERSION = "147.0"; 
  
  // 架构配置 (绝大多数现代手机都是这个)
  const ARCH = "android-arm64-v8a"; 

  // ============================================================
  // 辅助函数：尝试获取版本号
  // ============================================================
  async function getLatestVersion() {
    // 策略 A: 官方 mobile_versions.json (最快、最准)
    try {
      const resp = await fetch("https://product-details.mozilla.org/1.0/mobile_versions.json", {
        headers: { 'User-Agent': 'Mozilla/5.0 (Cloudflare-Worker)' }
      });
      if (resp.ok) {
        const data = await resp.json();
        // 尝试获取正式版版本号，不同时期字段可能不同，多试几个
        const ver = data.version || data.android_release || (data.release && data.release.version);
        if (ver) return ver;
      }
    } catch (e) {
      console.log("策略 A 失败:", e.message);
    }

    // 策略 B: 官方 firefox_versions.json (备用数据源)
    try {
      const resp = await fetch("https://product-details.mozilla.org/1.0/firefox_versions.json", {
        headers: { 'User-Agent': 'Mozilla/5.0 (Cloudflare-Worker)' }
      });
      if (resp.ok) {
        const data = await resp.json();
        // 查找 Android 相关的 Key
        const ver = data.LATEST_FIREFOX_ANDROID_VERSION || data.FIREFOX_ANDROID;
        if (ver) return ver;
      }
    } catch (e) {
      console.log("策略 B 失败:", e.message);
    }

    // 策略 C: 暴力扫描归档目录 (正则改进版)
    try {
      const resp = await fetch("https://archive.mozilla.org/pub/fenix/releases/", {
        headers: { 'User-Agent': 'Mozilla/5.0 (Cloudflare-Worker)' }
      });
      if (resp.ok) {
        const html = await resp.text();
        // 宽松正则：匹配所有以数字开头、以 / 结尾的 href 链接
        // 比如 href="147.0/" 或 href="147.0.1/"
        const regex = /href=["']?([0-9][0-9\.]*)[\/]["']?/g;
        const versions = [];
        let match;
        while ((match = regex.exec(html)) !== null) {
          versions.push(match[1]);
        }
        
        if (versions.length > 0) {
          // 排序逻辑：按数字分段比较，找出最大的
          return versions.sort((a, b) => {
            const partsA = a.split('.').map(Number);
            const partsB = b.split('.').map(Number);
            for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
              if ((partsA[i] || 0) < (partsB[i] || 0)) return -1;
              if ((partsA[i] || 0) > (partsB[i] || 0)) return 1;
            }
            return 0;
          }).pop();
        }
      }
    } catch (e) {
      console.log("策略 C 失败:", e.message);
    }

    // 策略 D: 绝望了，使用硬编码版本
    return EMERGENCY_VERSION;
  }

  try {
    // 1. 获取最佳版本号
    const version = await getLatestVersion();
    
    // 2. 构造下载链接
    // 路径: /pub/fenix/releases/<version>/android/fenix-<version>-android-arm64-v8a/fenix-<version>.multi.android-arm64-v8a.apk
    // 注意：有时候文件名里会有 build ID，所以我们先尝试标准文件名
    const baseUrl = `https://archive.mozilla.org/pub/fenix/releases/${version}/android/fenix-${version}-${ARCH}`;
    const standardFilename = `fenix-${version}.multi.${ARCH}.apk`;
    let downloadUrl = `${baseUrl}/${standardFilename}`;

    // 3. 验证文件是否存在 (HEAD 请求)
    // 如果标准文件名不存在，我们不得不再次扫描该版本的目录来找真实文件名
    // 但为了速度，我们先赌它存在。如果 Fetch 失败，脚本会捕获错误。

    // 4. 执行代理下载
    const fileResponse = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/109.0 Firefox/110.0',
      },
      redirect: 'follow'
    });

    // 如果直接下载失败（比如 404），说明文件名可能不规则
    // 这时候我们做一个最后的挽救：尝试列出该版本目录下的所有 .apk
    if (!fileResponse.ok) {
        const dirResp = await fetch(`${baseUrl}/`);
        if (dirResp.ok) {
            const dirHtml = await dirResp.text();
            // 找 .apk
            const apkMatch = dirHtml.match(/href=["']?([^"']+\.apk)["']?/);
            if (apkMatch) {
                downloadUrl = `${baseUrl}/${apkMatch[1]}`;
                // 再次尝试下载
                const retryResponse = await fetch(downloadUrl, { redirect: 'follow' });
                if (retryResponse.ok) {
                     return buildResponse(retryResponse, version);
                }
            }
        }
        // 如果挽救也失败，抛出异常
        throw new Error(`无法下载版本 ${version} (Status: ${fileResponse.status})`);
    }

    return buildResponse(fileResponse, version);

  } catch (error) {
    return new Response(`下载服务暂时不可用: ${error.message}`, { status: 500 });
  }
}

// 辅助函数：构建返回给用户的响应
function buildResponse(upstreamResponse, version) {
  const newHeaders = new Headers(upstreamResponse.headers);
  newHeaders.set('Content-Disposition', `attachment; filename="Firefox-Android-${version}.apk"`);
  newHeaders.set('Content-Type', 'application/vnd.android.package-archive');
  newHeaders.delete('Content-Length'); // 删除长度头，防止流传输中断

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: newHeaders
  });
}
