export interface DownloadImageResult {
  localPath: string;
  markdownRef: string;
  fileName: string;
}

export function isOnlineImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('https://skimd-asset.local/')) return false;
  return /^https?:\/\/[^\s"'<>]+$/i.test(trimmed);
}

// Match Markdown images: ![alt](url "optional title") or ![alt](<url>)
const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?)\s*\)/g;

// Match HTML <img ... src="url" ...>
const HTML_IMG_RE = /<img\b([^>]*?)\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')([^>]*)>/gi;

function processNonCodeLines(
  markdown: string,
  onLine: (line: string) => string
): string {
  const useCrlf = markdown.includes('\r\n');
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  let fenceChar = '';

  const out = lines.map((line) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const ch = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
      return line;
    }
    if (inFence) return line;
    return onLine(line);
  });

  return out.join(useCrlf ? '\r\n' : '\n');
}

export function findOnlineImageUrls(markdown: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  processNonCodeLines(markdown, (line) => {
    MD_IMAGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MD_IMAGE_RE.exec(line)) !== null) {
      const rawUrl = (m[2] ?? m[3] ?? '').trim();
      if (isOnlineImageUrl(rawUrl) && !seen.has(rawUrl)) {
        seen.add(rawUrl);
        urls.push(rawUrl);
      }
    }

    HTML_IMG_RE.lastIndex = 0;
    while ((m = HTML_IMG_RE.exec(line)) !== null) {
      const rawUrl = (m[2] ?? m[3] ?? '').trim();
      if (isOnlineImageUrl(rawUrl) && !seen.has(rawUrl)) {
        seen.add(rawUrl);
        urls.push(rawUrl);
      }
    }
    return line;
  });

  return urls;
}

export function replaceImageUrlInMarkdown(
  markdown: string,
  targetUrl: string,
  localRef: string
): string {
  const safeRef = /\s/.test(localRef) ? `<${localRef}>` : localRef;

  return processNonCodeLines(markdown, (line) => {
    let updated = line.replace(
      MD_IMAGE_RE,
      (full, alt: string, angleUrl: string, plainUrl: string, titlePart: string) => {
        const found = (angleUrl ?? plainUrl ?? '').trim();
        if (found !== targetUrl) return full;
        return `![${alt}](${safeRef}${titlePart ?? ''})`;
      }
    );

    updated = updated.replace(
      HTML_IMG_RE,
      (full, before: string, dqUrl: string, sqUrl: string, after: string) => {
        const found = (dqUrl ?? sqUrl ?? '').trim();
        if (found !== targetUrl) return full;
        const quote = dqUrl !== undefined ? '"' : "'";
        return `<img${before}src=${quote}${localRef}${quote}${after}>`;
      }
    );

    return updated;
  });
}
