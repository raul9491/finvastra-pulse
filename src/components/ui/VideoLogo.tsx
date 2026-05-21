// Video logo component — uses the animated webm served from /public/video/
// dark prop (default false): when true, renders text in navy/gold for light backgrounds

interface VideoLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showText?: boolean;
  dark?: boolean;  // true = dark text for light backgrounds (e.g. white header)
}

const SIZE_MAP: Record<NonNullable<VideoLogoProps['size']>, number> = {
  xs: 32,
  sm: 48,
  md: 72,
  lg: 100,
};

const FONT_SIZE_MAP: Record<NonNullable<VideoLogoProps['size']>, number> = {
  xs: 14,
  sm: 16,
  md: 22,
  lg: 28,
};

const LABEL_SIZE_MAP: Record<NonNullable<VideoLogoProps['size']>, number> = {
  xs: 7,
  sm: 8,
  md: 8,
  lg: 8,
};

export function VideoLogo({ size = 'sm', showText = true, dark = false }: VideoLogoProps) {
  const px          = SIZE_MAP[size];
  const nameSize    = FONT_SIZE_MAP[size];
  const labelSize   = LABEL_SIZE_MAP[size];
  const nameColor   = dark ? '#0B1538' : '#FFFFFF';
  const accentColor = dark ? '#9A7E3F' : '#C9A961';
  const labelColor  = dark ? '#9A7E3F' : '#9A7E3F';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <video
        autoPlay
        loop
        muted
        playsInline
        style={{ width: px, height: px, objectFit: 'contain', display: 'block' }}
      >
        <source src="/video/logo-transparent.webm" type="video/webm" />
      </video>

      {showText && (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily:    "'Fraunces', Georgia, serif",
            fontWeight:    900,
            fontSize:      nameSize,
            color:         nameColor,
            letterSpacing: '-0.03em',
            lineHeight:    1,
          }}>
            Fin<span style={{ color: accentColor }}>vastra</span>
          </div>
          <div style={{
            fontSize:      labelSize,
            fontWeight:    700,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color:         labelColor,
            marginTop:     3,
          }}>
            PULSE
          </div>
        </div>
      )}
    </div>
  );
}
