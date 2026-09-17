import React from 'react';
import { appleMapsUrl, isMappableLocation, mapsPlaceLabel } from './mapsLink.js';

export default function MapsLocationLink({
  address,
  icon = null,
  className,
  linkClassName,
  plainClassName
}) {
  const text = mapsPlaceLabel(address);
  if (!text) return null;

  const mappable = isMappableLocation(text);
  const classes = className
    || (mappable
      ? (linkClassName || 'inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 hover:underline')
      : (plainClassName || 'inline-flex items-center gap-1'));

  if (!mappable) {
    return (
      <span className={classes}>
        {icon}
        {text}
      </span>
    );
  }

  return (
    <a
      href={appleMapsUrl(text)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`pointer-events-auto ${classes}`}
      aria-label={`Open ${text} in Maps`}
    >
      {icon}
      {text}
    </a>
  );
}
