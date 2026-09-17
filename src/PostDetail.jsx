import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Paperclip, X } from 'lucide-react';

function decodeHtml(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
}

export function isDeadPostImage(image) {
  const src = String(image?.src || image || '').trim();
  const alt = String(image?.alt || image?.caption || '').trim();
  if (!src || src === '?' || src === '#' || src === 'undefined' || src === 'null') return true;
  if (alt === '?' || alt === '??') return true;
  if (/-2147483648/.test(src)) return true;
  const hay = `${src} ${alt}`.toLowerCase();
  if (/question[_\s-]?mark|nophoto|no[_-]?photo|no[_-]?image|placeholder|missing[_-]?image|unknown[_-]?user|default[_-]?user|large_user\.|small_user\.|ftpimages\/0\//i.test(hay)) {
    return true;
  }
  try {
    const file = decodeURIComponent((new URL(src, 'https://local.invalid').pathname.split('/').pop() || '').split('?')[0]);
    if (file === '?' || file === '.') return true;
  } catch {
    return true;
  }
  return false;
}

export function liveImageSrc(image) {
  if (!image) return null;
  const src = typeof image === 'string' ? image : image.src;
  if (!src || isDeadPostImage(typeof image === 'string' ? { src } : image)) return null;
  return src;
}

export function SafePostImage({ src, alt = '', className, ...rest }) {
  const [hidden, setHidden] = useState(false);
  const live = liveImageSrc({ src, alt });
  useEffect(() => {
    setHidden(false);
  }, [live]);
  if (!live || hidden) return null;
  return (
    <img
      src={live}
      alt={alt}
      className={className}
      onError={() => setHidden(true)}
      {...rest}
    />
  );
}

function sanitizeArticleHtml(html) {
  if (!html || typeof document === 'undefined') return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body;
  root.querySelectorAll('script,style,iframe,object,embed,form,link,meta,video,audio').forEach((el) => el.remove());
  root.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = String(attr.value || '').trim();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
        el.removeAttribute(attr.name);
        return;
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^(javascript|data|vbscript):/i.test(val)) {
        el.removeAttribute(attr.name);
      }
    });
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  root.querySelectorAll('img').forEach((img) => {
    const src = String(img.getAttribute('src') || '').trim();
    const alt = String(img.getAttribute('alt') || '').trim();
    if (!src || src === '?' || alt === '?' || isDeadPostImage({ src, alt })) {
      img.remove();
      return;
    }
    const href = img.getAttribute('data-original') || src;
    if (!img.closest('a') && href) {
      const wrap = doc.createElement('a');
      wrap.setAttribute('href', href);
      wrap.setAttribute('target', '_blank');
      wrap.setAttribute('rel', 'noopener noreferrer');
      img.parentNode?.insertBefore(wrap, img);
      wrap.appendChild(img);
    }
  });
  return root.innerHTML;
}

function PostMediaFigure({ image }) {
  const [hidden, setHidden] = useState(false);
  const src = liveImageSrc(image);
  if (!src || hidden) return null;
  const href = image.href || image.src;
  const picture = (
    <img
      src={src}
      alt={image.caption ? '' : (image.alt || '')}
      onError={() => setHidden(true)}
    />
  );
  return (
    <figure>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {picture}
        </a>
      ) : picture}
      {(image.caption || image.note) ? (
        <figcaption>{[image.caption, image.note].filter(Boolean).join(' — ')}</figcaption>
      ) : null}
    </figure>
  );
}

function feedLabel(item) {
  if (item?.feed === 'notes') return 'Official note';
  if (item?.feed === 'news') return item.type === 'Bulletin' ? 'Bulletin' : 'News';
  if (item?.feed === 'resources') return 'Resource';
  if (item?.feed === 'bulletin') return 'Bulletin';
  if (item?.feed === 'topics') return 'Topic';
  return item?.type || item?.kind || 'Post';
}

export function toPostItem(item, extra = {}) {
  if (!item) return null;
  const html = item.html || item.bodyHtml || (looksLikeHtml(item.description) ? item.description : '')
    || (looksLikeHtml(item.body) ? item.body : '');
  const description = item.description || item.body || item.emailBody || item.snippet || '';
  return {
    ...item,
    ...extra,
    title: item.title || extra.title || 'Post',
    date: item.date || item.publishDate || extra.date || '',
    author: item.author || extra.author || '',
    html,
    description,
    images: Array.isArray(item.images) ? item.images.filter((image) => liveImageSrc(image)) : [],
    files: Array.isArray(item.files) ? item.files : (item.attachments || []),
    links: Array.isArray(item.links) ? item.links : [],
    imageUrl: liveImageSrc({ src: item.imageUrl, alt: item.title })
      || liveImageSrc({ src: extra.imageUrl })
      || null,
    url: item.url || extra.url || null,
    feed: extra.feed || item.feed || item.kind || 'post',
    viewed: extra.viewed != null ? extra.viewed : item.viewed !== false,
    type: extra.type || item.type || item.kind || 'Post',
    source: extra.source || item.source || ''
  };
}

export default function PostDetail({ post, onClose, onToggleRead }) {
  const closeRef = useRef(null);
  const htmlRef = useRef(null);
  const titleId = 'post-detail-title';
  const unread = post?.viewed === false;
  const html = looksLikeHtml(post?.html) ? sanitizeArticleHtml(post.html)
    : (looksLikeHtml(post?.description) ? sanitizeArticleHtml(post.description) : '');
  const plain = html ? '' : decodeHtml(post?.description || post?.body || '');
  const images = (post?.images || []).filter((image) => liveImageSrc(image));
  const files = post?.files || [];
  const links = (post?.links || []).filter((link) => link?.url && link.url !== post?.url);
  const coverSrc = liveImageSrc({ src: post.imageUrl, alt: post.title });
  const cover = coverSrc && !images.some((image) => image.src === coverSrc)
    ? { src: coverSrc, alt: post.title || '', caption: '', href: post.imageUrl }
    : null;
  const media = (cover ? [cover, ...images] : images).filter((image) => liveImageSrc(image));
  const meta = [post?.date, post?.author, post?.student && post.student !== 'All' ? post.student : null]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    const prev = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const root = htmlRef.current;
    if (!root) return undefined;
    const imgs = [...root.querySelectorAll('img')];
    const onError = (event) => {
      const img = event.currentTarget;
      img.hidden = true;
      img.style.display = 'none';
      img.removeAttribute('src');
      const frame = img.closest('a') || img.closest('figure');
      if (frame && frame.querySelectorAll('img:not([hidden])').length === 0) {
        frame.hidden = true;
        frame.style.display = 'none';
      }
    };
    imgs.forEach((img) => img.addEventListener('error', onError));
    return () => {
      imgs.forEach((img) => img.removeEventListener('error', onError));
    };
  }, [html]);

  if (!post) return null;

  return (
    <div className="post-detail-root" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="post-detail-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="post-detail-grabber" aria-hidden="true" />
        <header className="post-detail-toolbar">
          <button
            ref={closeRef}
            type="button"
            className="post-detail-icon-btn"
            aria-label="Close article"
            onClick={onClose}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
          <p className="post-detail-kicker">{feedLabel(post)}</p>
          <button
            type="button"
            className="post-detail-read-btn"
            onClick={() => onToggleRead?.(unread)}
          >
            {unread ? 'Mark as read' : 'Mark as unread'}
          </button>
        </header>

        <div className="post-detail-scroll">
          <h2 id={titleId} className="post-detail-title">{decodeHtml(post.title)}</h2>
          {meta ? <p className="post-detail-meta">{meta}</p> : null}

          {media.length > 0 ? (
            <div className="post-detail-media">
              {media.map((image, index) => (
                <PostMediaFigure key={image.src || index} image={image} />
              ))}
            </div>
          ) : null}

          {html ? (
            <div
              ref={htmlRef}
              className="post-detail-html"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : plain ? (
            <p className="post-detail-plain">{plain}</p>
          ) : null}

          {files.length > 0 ? (
            <ul className="post-detail-files">
              {files.map((file, index) => (
                <li key={file.url || index}>
                  {file.url ? (
                    <a href={file.url} target="_blank" rel="noopener noreferrer">
                      <Paperclip className="w-4 h-4" aria-hidden="true" />
                      {file.name || 'Attachment'}
                    </a>
                  ) : (
                    <span>
                      <Paperclip className="w-4 h-4" aria-hidden="true" />
                      {file.name || 'Attachment'}
                    </span>
                  )}
                  {file.note ? <span className="post-detail-file-note">{file.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {(links.length > 0 || post.url) ? (
            <ul className="post-detail-links">
              {post.url ? (
                <li>
                  <a href={post.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />
                    Open original
                  </a>
                </li>
              ) : null}
              {links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />
                    {link.label || link.url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
