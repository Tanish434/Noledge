'use client';

import React, { useState, useEffect } from 'react';

const CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?/~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

interface ScrambleTextProps {
  text: string;
  scrambleSpeed?: number;
  scrambledClassName?: string;
  className?: string;
  trigger?: any;
}

export function ScrambleText({
  text,
  scrambleSpeed = 30,
  scrambledClassName = 'text-purple-400',
  className = '',
  trigger = 0,
}: ScrambleTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const [isScrambling, setIsScrambling] = useState(false);

  useEffect(() => {
    setIsScrambling(true);
    let frame = 0;
    const totalFrames = Math.max(12, text.length * 2.5);

    const interval = setInterval(() => {
      frame++;
      const progress = frame / totalFrames;
      const revealedLength = Math.floor(progress * text.length);

      const result = text
        .split('')
        .map((char, index) => {
          if (index < revealedLength) return char;
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        })
        .join('');

      setDisplayText(result);

      if (frame >= totalFrames) {
        clearInterval(interval);
        setDisplayText(text);
        setIsScrambling(false);
      }
    }, scrambleSpeed);

    return () => clearInterval(interval);
  }, [text, scrambleSpeed, trigger]);

  return (
    <span className={`${className} ${isScrambling ? scrambledClassName : ''}`}>
      {displayText}
    </span>
  );
}
