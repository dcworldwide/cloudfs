export function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        d="M19.4 13.5a7.7 7.7 0 0 0 .1-1.5 7.7 7.7 0 0 0-.1-1.5l2-1.6-2-3.4-2.4 1a7.8 7.8 0 0 0-2.6-1.5l-.4-2.6h-4l-.4 2.6a7.8 7.8 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0-.1 1.5c0 .5 0 1 .1 1.5l-2 1.6 2 3.4 2.4-1a7.8 7.8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a7.8 7.8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6Z"
      />
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11Z" opacity="0.9" />
    </svg>
  );
}

export function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M6 3.5A1.5 1.5 0 0 1 7.5 2H14l5 5v13.5A1.5 1.5 0 0 1 17.5 22h-10A1.5 1.5 0 0 1 6 20.5v-17Z" opacity="0.75" />
      <path fill="currentColor" d="M14 2v5h5" opacity="0.45" />
    </svg>
  );
}

export function ComputerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.7" d="M4 5.5h16v10H4zM8 19.5h8M12 15.5v4" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.7" d="M8 8h11v12H8z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.7" d="M5 16V4h11" />
    </svg>
  );
}

export function MoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" d="M5 12h12M13 7l5 5-5 5" />
    </svg>
  );
}

/** Amazon S3 smile mark. Drawn as a compact vendor glyph, not the wordmark. */
export function S3Icon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#FF9900" d="M12 2.2 3.2 6.4v7.2c0 5 3.7 8.2 8.8 9.2 5.1-1 8.8-4.2 8.8-9.2V6.4L12 2.2Z" />
      <path fill="none" stroke="#232F3E" strokeWidth="1.6" strokeLinecap="round" d="M7.2 13.2c1.4 1.5 3 2.3 4.8 2.3s3.4-.8 4.8-2.3" />
      <path fill="none" stroke="#232F3E" strokeWidth="1.6" strokeLinecap="round" d="M8.4 10.2c1 1.1 2.2 1.7 3.6 1.7s2.6-.6 3.6-1.7" />
    </svg>
  );
}

/** Microsoft Azure mark: the four-square cloud glyph in the vendor blue. */
export function AzureIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#0078D4" d="M10.6 3.2 3.4 17.6h4.2L13.2 6.4 10.6 3.2Z" />
      <path fill="#50E6FF" d="M13.4 8.2 8.8 17.6h11.8L13.4 8.2Z" />
      <path fill="#0078D4" d="M11.2 17.6h9.4l-2.2 3.2H8.6l2.6-3.2Z" />
    </svg>
  );
}

/** Google Cloud Storage mark: the four Google colors as a bucket glyph. */
export function GcsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M12 3.2 6.2 6.4v4.2L12 13.8l5.8-3.2V6.4L12 3.2Z" />
      <path fill="#34A853" d="M6.2 11.4v6.2L12 20.8v-6.4L6.2 11.4Z" />
      <path fill="#FBBC05" d="M12 14.4v6.4l5.8-3.2v-6.2L12 14.4Z" />
      <path fill="#EA4335" d="M12 8.6 8.4 10.6 12 12.6l3.6-2L12 8.6Z" />
    </svg>
  );
}

export function CloudIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 18.5a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.5-1.2A4 4 0 0 1 17.5 18.5H7Z" opacity="0.85" />
    </svg>
  );
}
