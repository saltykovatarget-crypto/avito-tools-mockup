import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

const PURPLE = '#5B47E0';
const DARK = '#0D0D1A';
const WHITE = '#FFFFFF';
const GRAY = '#A0A0B8';
const RED = '#FF5B5B';

function FadeIn({ children, delay = 0 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = spring({ frame: frame - delay, fps, from: 0, to: 1, config: { damping: 20 } });
  const y = interpolate(frame - delay, [0, 15], [30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ opacity: Math.max(0, opacity), transform: `translateY(${y}px)` }}>
      {children}
    </div>
  );
}

function Scene1() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, from: 0.5, to: 1, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ background: DARK, justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 20 }}>
      <div style={{ transform: `scale(${scale})`, textAlign: 'center' }}>
        <div style={{ fontSize: 72, fontWeight: 900, color: WHITE, fontFamily: 'sans-serif', letterSpacing: -2 }}>
          AI <span style={{ color: PURPLE }}>Авитолог</span> PRO
        </div>
        <FadeIn delay={15}>
          <div style={{ fontSize: 26, color: GRAY, marginTop: 16, fontFamily: 'sans-serif' }}>
            Автоматизация работы с Авито
          </div>
        </FadeIn>
      </div>
      <FadeIn delay={25}>
        <div style={{ width: 80, height: 4, background: PURPLE, borderRadius: 2, marginTop: 8 }} />
      </FadeIn>
    </AbsoluteFill>
  );
}

function Scene2() {
  return (
    <AbsoluteFill style={{ background: DARK, justifyContent: 'center', alignItems: 'center', padding: '0 120px' }}>
      <div style={{ textAlign: 'center' }}>
        <FadeIn delay={0}>
          <div style={{ fontSize: 18, color: PURPLE, fontFamily: 'sans-serif', fontWeight: 700, marginBottom: 24, textTransform: 'uppercase', letterSpacing: 4 }}>
            Проблема
          </div>
        </FadeIn>
        <FadeIn delay={8}>
          <div style={{ fontSize: 64, fontWeight: 900, color: WHITE, fontFamily: 'sans-serif', lineHeight: 1.15 }}>
            Тратите деньги<br />на VAS <span style={{ color: RED }}>вслепую?</span>
          </div>
        </FadeIn>
        <FadeIn delay={20}>
          <div style={{ fontSize: 26, color: GRAY, marginTop: 28, fontFamily: 'sans-serif', lineHeight: 1.6 }}>
            Не знаете на каких позициях<br />стоят ваши объявления?
          </div>
        </FadeIn>
      </div>
    </AbsoluteFill>
  );
}

function Scene3() {
  const features = [
    { icon: '📊', text: 'Мониторинг позиций каждый день', delay: 5 },
    { icon: '📱', text: 'Уведомления в Telegram', delay: 15 },
    { icon: '🤖', text: 'Автоматизация VAS-стратегии', delay: 25 },
    { icon: '🔗', text: 'Подключение через Avito API', delay: 35 },
  ];
  return (
    <AbsoluteFill style={{ background: DARK, justifyContent: 'center', alignItems: 'center', flexDirection: 'column', padding: '0 120px', gap: 24 }}>
      <FadeIn delay={0}>
        <div style={{ fontSize: 52, fontWeight: 900, color: WHITE, fontFamily: 'sans-serif', textAlign: 'center', marginBottom: 16 }}>
          AI делает всё <span style={{ color: PURPLE }}>за вас</span>
        </div>
      </FadeIn>
      {features.map((f, i) => (
        <FadeIn key={i} delay={f.delay}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 20,
            background: 'rgba(91,71,224,0.12)',
            border: '1.5px solid rgba(91,71,224,0.35)',
            borderRadius: 16, padding: '18px 32px', width: 700,
          }}>
            <span style={{ fontSize: 32 }}>{f.icon}</span>
            <span style={{ fontSize: 22, color: WHITE, fontFamily: 'sans-serif', fontWeight: 500 }}>{f.text}</span>
          </div>
        </FadeIn>
      ))}
    </AbsoluteFill>
  );
}

function Scene4() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const btnScale = spring({ frame, fps, from: 0.85, to: 1, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, #0D0D1A 0%, #1a1040 100%)`, justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 36 }}>
      <FadeIn delay={0}>
        <div style={{ fontSize: 52, fontWeight: 900, color: WHITE, fontFamily: 'sans-serif', textAlign: 'center' }}>
          Начните прямо сейчас
        </div>
      </FadeIn>
      <FadeIn delay={12}>
        <div style={{
          transform: `scale(${btnScale})`,
          background: PURPLE, borderRadius: 18,
          padding: '22px 56px', fontSize: 26, fontWeight: 700,
          color: WHITE, fontFamily: 'sans-serif',
        }}>
          Подключить кабинет Авито →
        </div>
      </FadeIn>
      <FadeIn delay={22}>
        <div style={{ fontSize: 20, color: GRAY, fontFamily: 'sans-serif' }}>
          AI Авитолог PRO
        </div>
      </FadeIn>
    </AbsoluteFill>
  );
}

export function PromoVideo() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const S1 = fps * 4;
  const S2 = fps * 10;
  const S3 = fps * 22;

  const fade = (end) => interpolate(frame, [end - 6, end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      {frame < S1 && <div style={{ opacity: fade(S1), position: 'absolute', inset: 0 }}><Scene1 /></div>}
      {frame >= S1 && frame < S2 && <div style={{ opacity: fade(S2), position: 'absolute', inset: 0 }}><Scene2 /></div>}
      {frame >= S2 && frame < S3 && <div style={{ opacity: fade(S3), position: 'absolute', inset: 0 }}><Scene3 /></div>}
      {frame >= S3 && <div style={{ position: 'absolute', inset: 0 }}><Scene4 /></div>}
    </AbsoluteFill>
  );
}
