import type { Locator } from '@playwright/test';

// Measure rendered sRGB colours, including transparent surfaces and disabled opacity.
export async function contrastOf(locator: Locator) {
  return locator.evaluate(element => {
    type Color = [number, number, number, number];
    const parse = (value: string): Color => {
      const parts = value.match(/[\d.]+/g)!.map(Number);
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
    };
    const over = (front: Color, back: Color): Color => {
      const a = front[3] + back[3] * (1 - front[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map(i => (front[i]! * front[3] + back[i]! * back[3] * (1 - front[3])) / a).concat(a) as Color;
    };
    const chain: Element[] = []; for (let node: Element | null = element; node; node = node.parentElement) chain.push(node);
    let foreground = parse(getComputedStyle(element).color), background: Color = [0, 0, 0, 0];
    for (const node of chain) {
      const style = getComputedStyle(node), surface = parse(style.backgroundColor), opacity = Number(style.opacity);
      background = over(background, surface); foreground = over(foreground, surface);
      background[3] *= opacity; foreground[3] *= opacity;
    }
    background = over(background, [255, 255, 255, 1]); foreground = over(foreground, [255, 255, 255, 1]);
    const luminance = (color: Color) => color.slice(0, 3).map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [ .2126, .7152, .0722 ][i]!, 0);
    const f = luminance(foreground), b = luminance(background), style = getComputedStyle(element);
    const border = luminance(parse(style.borderTopColor));
    return { foreground: foreground.slice(0, 3).map(Math.round), background: background.slice(0, 3).map(Math.round), ratio: (Math.max(f, b) + .05) / (Math.min(f, b) + .05), borderRatio: (Math.max(border, b) + .05) / (Math.min(border, b) + .05), fontSize: style.fontSize, fontWeight: style.fontWeight, opacity: style.opacity, borderColor: style.borderColor, outlineColor: style.outlineColor, outlineStyle: style.outlineStyle };
  });
}
