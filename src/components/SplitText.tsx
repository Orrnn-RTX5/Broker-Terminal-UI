import React, { useEffect, useMemo, useRef, useState } from 'react';

type MotionVars = {
    opacity?: number;
    y?: number | string;
    filter?: string;
};

interface SplitTextProps {
    tag?: React.ElementType;
    text: string;
    children?: React.ReactNode;
    className?: string;
    delay?: number;
    initialDelay?: number;
    duration?: number;
    ease?: string;
    splitType?: string;
    from?: MotionVars;
    to?: MotionVars;
    threshold?: number;
    rootMargin?: string;
    textAlign?: React.CSSProperties['textAlign'];
    onLetterAnimationComplete?: () => void;
}

const cssEaseMap: Record<string, string> = {
    'power3.out': 'cubic-bezier(0.22, 1, 0.36, 1)',
    'power2.out': 'cubic-bezier(0.16, 1, 0.3, 1)',
};

const toCssLength = (value: number | string | undefined, fallback = '0px') =>
    typeof value === 'number' ? `${value}px` : value || fallback;

const getMotionStyle = (
    visible: boolean,
    from: MotionVars,
    to: MotionVars,
    duration: number,
    delayMs: number,
    ease: string,
    reducedMotion: boolean
): React.CSSProperties => {
    const active = visible || reducedMotion;
    const opacity = active ? (to.opacity ?? 1) : (from.opacity ?? 0);
    const y = active ? toCssLength(to.y) : toCssLength(from.y);
    const filter = active ? (to.filter ?? 'none') : (from.filter ?? 'none');
    const transition = reducedMotion
        ? 'none'
        : [
            `opacity ${duration}s ${ease} ${delayMs}ms`,
            `transform ${duration}s ${ease} ${delayMs}ms`,
            `filter ${duration}s ${ease} ${delayMs}ms`,
        ].join(', ');

    return {
        opacity,
        filter,
        transform: `translate3d(0, ${y}, 0)`,
        transition,
        willChange: active ? 'auto' : 'transform, opacity, filter',
    };
};

export default function SplitText({
    text,
    children,
    className = '',
    delay = 50,
    initialDelay = 0,
    duration = 1.25,
    ease = 'power3.out',
    splitType = 'chars',
    from = { opacity: 0, y: 40 },
    to = { opacity: 1, y: 0 },
    threshold = 0.1,
    rootMargin = '-100px',
    textAlign = 'center',
    tag = 'p',
    onLetterAnimationComplete,
}: SplitTextProps) {
    const ref = useRef<HTMLElement | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const callbackRef = useRef(onLetterAnimationComplete);
    const hasCompletedRef = useRef(false);
    const Tag = tag;
    const cssEase = cssEaseMap[ease] || ease;
    const shouldSplitChars = splitType.includes('chars');
    const shouldSplitWords = splitType.includes('words');
    const hasCustomContent = children !== undefined;

    const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);

    useEffect(() => {
        callbackRef.current = onLetterAnimationComplete;
    }, [onLetterAnimationComplete]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

        updatePreference();
        mediaQuery.addEventListener?.('change', updatePreference);
        return () => mediaQuery.removeEventListener?.('change', updatePreference);
    }, []);

    useEffect(() => {
        const element = ref.current;
        if (!element || isVisible) return;

        if (typeof IntersectionObserver === 'undefined') {
            setIsVisible(true);
            return;
        }

        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { threshold, rootMargin }
        );

        observer.observe(element);
        return () => observer.disconnect();
    }, [isVisible, rootMargin, threshold]);

    useEffect(() => {
        if ((!isVisible && !prefersReducedMotion) || hasCompletedRef.current) return;

        const animatedCount = hasCustomContent
            ? 1
            : shouldSplitChars
            ? text.replace(/\s/g, '').length
            : shouldSplitWords
                ? words.length
                : 1;
        const totalMs = prefersReducedMotion
            ? 0
            : initialDelay + Math.max(0, (animatedCount - 1) * delay) + duration * 1000;
        const timeoutId = window.setTimeout(() => {
            hasCompletedRef.current = true;
            callbackRef.current?.();
        }, totalMs);

        return () => window.clearTimeout(timeoutId);
    }, [delay, duration, hasCustomContent, initialDelay, isVisible, prefersReducedMotion, shouldSplitChars, shouldSplitWords, text, words.length]);

    let targetIndex = 0;
    const nextStyle = () => getMotionStyle(
        isVisible,
        from,
        to,
        duration,
        initialDelay + targetIndex++ * delay,
        cssEase,
        prefersReducedMotion
    );

    const content = hasCustomContent
        ? (
            <span className="split-char" aria-hidden="true" style={nextStyle()}>
                {children}
            </span>
        )
        : shouldSplitWords
        ? words.map((word, wordIndex) => (
            <React.Fragment key={`${word}-${wordIndex}`}>
                {wordIndex > 0 && ' '}
                <span className="split-word" aria-hidden="true">
                    {shouldSplitChars
                        ? Array.from(word).map((char, charIndex) => (
                            <span
                                key={`${char}-${charIndex}`}
                                className="split-char"
                                aria-hidden="true"
                                style={nextStyle()}
                            >
                                {char}
                            </span>
                        ))
                        : (
                            <span style={nextStyle()}>{word}</span>
                        )}
                </span>
            </React.Fragment>
        ))
        : Array.from(text).map((char, charIndex) => (
            <span
                key={`${char}-${charIndex}`}
                className="split-char"
                aria-hidden="true"
                style={nextStyle()}
            >
                {char === ' ' ? '\u00a0' : char}
            </span>
        ));

    return (
        <Tag
            ref={ref}
            className={`split-parent ${className}`.trim()}
            style={{
                textAlign,
                overflow: 'visible',
                display: 'inline-block',
                whiteSpace: 'normal',
                overflowWrap: 'break-word',
            }}
            aria-label={text}
        >
            {content}
        </Tag>
    );
}
