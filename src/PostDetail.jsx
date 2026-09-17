import React, { useEffect, useRef } from 'react';
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
  return root.innerHTML;
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
    images: Array.isArray(item.images) ? item.images : [],
    files: Array.isArray(item.files) ? item.files : (item.attachments || []),
    links: Array.isArray(item.links) ? item.links : [],
    imageUrl: item.imageUrl || extra.imageUrl || null,
    url: item.url || extra.url || null,
    feed: extra.feed || item.feed || item.kind || 'post',
    viewed: extra.viewed != null ? extra.viewed : item.viewed !== false,
    type: extra.type || item.type || item.kind || 'Post',
    source: extra.source || item.source || ''
  };
}

export default function PostDetail({ post, onClose, onToggleRead }) {
  const closeRef = useRef(null);
  const titleId = 'post-detail-title';
  const unread = post?.viewed === false;
  const html = looksLikeHtml(post?.html) ? sanitizeArticleHtml(post.html)
    : (looksLikeHtml(post?.description) ? sanitizeArticleHtml(post.description) : '');
  const plain = html ? '' : decodeHtml(post?.description || post?.body || '');
  const images = post?.images || [];
  const files = post?.files || [];
  const links = (post?.links || []).filter((link) => link?.url && link.url !== post?.url);
  const cover = post?.imageUrl && !images.some((image) => image.src === post.imageUrl)
    ? { src: post.imageUrl, alt: post.title || '', caption: '' }
    : null;
  const media = cover ? [cover, ...images] : images;
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
                <figure key={image.src || index}>
                  <img
                    src={image.src}
                    alt={image.caption ? '' : (image.alt || '')}
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                  {(image.caption || image.note) ? (
                    <figcaption>{[image.caption, image.note].filter(Boolean).join(' — ')}</figcaption>
                  ) : null}
                </figure>
              ))}
            </div>
          ) : null}

          {html ? (
            <div className="post-detail-html" dangerouslySetInnerHTML={{ __html: html }} />
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
