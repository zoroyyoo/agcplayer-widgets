const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');

const REPO_OWNER = 'zoroyyoo';
const REPO_NAME = 'agcplayer-widgets';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/widgets`;

const CACHE_DIR = path.join(__dirname, '.caches');
const METADATA_PATH = path.join(CACHE_DIR, 'metadata.json');


let metadata = [];

// 过滤不需要检查的组件
const ignores = [
    'server-emby.zip',
    'server-jellyfin.zip',
    'storage-115.zip',
]

// 创建缓存目录
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}


// 删除 .caches 目录
function cleanCacheDir() {
    if (fs.existsSync(CACHE_DIR)) {
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
        console.log('🧹 已清理 .caches 目录');
    }
}

async function fetchZipFiles() {
    try {
        const response = await axios.get(GITHUB_API_URL, {
            headers: { 'Accept': 'application/vnd.github.v3+json' }
        });

        // 过滤带版本号的zip包
        const VERSIONED_ZIP_REGEX = /^.+-\d+\.\d+\.\d+\.zip$/;

        return response.data.filter(file => file.name.endsWith('.zip') && !VERSIONED_ZIP_REGEX.test(file.name) && !ignores.includes(file.name));
    } catch (error) {
        console.error('❌ 获取 ZIP 文件列表失败:', error);
        return [];
    }
}

async function downloadFile(url, outputPath) {
    const writer = fs.createWriteStream(outputPath);
    const response = await axios.get(url, { responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

function extractZip(zipPath, extractPath) {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);
    console.log(`✅ 解压完成: ${zipPath}`);
}

async function checkWidgetJs(directory) {
    const widgetPath = path.join(directory, 'widget.js');
    const widgetJsonPath = path.join(directory, 'widget.json');


    if (!fs.existsSync(widgetPath) || !fs.existsSync(widgetJsonPath)) {
        throw new Error('异常组件包')
    }

    let widgetName = ''
    let widgetVersion = ''

    try {
        const widget = require(widgetPath);
        const widgetJson = require(widgetJsonPath)
        widgetName = widgetJson?.name
        widgetVersion = widgetJson?.version

        if (typeof widget.home !== 'function') {
            throw new Error('home is not a function')
        }
        const result = await widget.home();
        if (result.code !== 0) {
            throw new Error(result.msg)
        }

        return {
            name: widgetName,
            version: widgetVersion,
            code: 0,

        }
    } catch (error) {
        return {
            name: widgetName,
            version: widgetVersion,
            code: -1,
            msg: error.message,
        }
    }
}

async function main() {
    ensureCacheDir();
    const zipFiles = await fetchZipFiles();
    if (zipFiles.length === 0) {
        return;
    }
    for (const zip of zipFiles) {
        const zipPath = path.join(CACHE_DIR, zip.name);
        const extractPath = path.join(CACHE_DIR, zip.name.replace('.zip', ''));
        console.log('extractPath', extractPath)

        console.log(`📥 下载 ZIP 文件: ${zip.download_url}`, zipPath);
        await downloadFile(zip.download_url, zipPath);

        extractZip(zipPath, extractPath);

        const widget = await checkWidgetJs(extractPath);
        const isValid = widget.code === 0
        metadata.push({
            code: widget.code,
            name: widget?.name || zip.name,
            version: widget?.version,
            msg: !isValid ? widget?.msg : '',
            download_url: zip.download_url
        });
    }
    // 将结果写入 metadata.json
    fs.writeFileSync(path.join(__dirname, 'metadata.json'), JSON.stringify(metadata, null, 2));

    console.log('✅ metadata.json 生成完毕:', METADATA_PATH);

    // 删除 .caches 目录
    cleanCacheDir();
}

main();
