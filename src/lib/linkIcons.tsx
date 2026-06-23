import type { IconType } from 'react-icons'
import {
  FaInstagram,
  FaFacebook,
  FaXTwitter,
  FaLinkedin,
  FaYoutube,
  FaTiktok,
  FaWhatsapp,
  FaSnapchat,
  FaPinterest,
  FaTelegram,
  FaGlobe,
  FaUtensils,
  FaLink,
  FaLocationDot,
} from 'react-icons/fa6'

// Adaptive icon for a merchant link: we look at the URL's host and pick a brand
// icon (with the brand's colour) so an Instagram link shows the Instagram glyph,
// a website shows a globe, an online menu shows cutlery, etc. Adding a new
// platform is just one row here — links store only the URL, never the icon.

export interface LinkIcon {
  Icon: IconType
  /** Brand colour for the icon. */
  color: string
  /** Human label for the platform (used as a tooltip / default link label). */
  label: string
}

// Ordered host-substring → icon rules. First match wins, so put more specific
// hosts before generic ones. Hosts are matched case-insensitively against the
// URL's hostname (and, for a couple, the path — e.g. "/menu").
const RULES: { test: (host: string, path: string) => boolean; icon: LinkIcon }[] =
  [
    {
      test: (h) => h.includes('instagram.') || h === 'instagr.am',
      icon: { Icon: FaInstagram, color: '#E4405F', label: 'Instagram' },
    },
    {
      test: (h) => h.includes('facebook.') || h.includes('fb.com') || h.includes('fb.me'),
      icon: { Icon: FaFacebook, color: '#1877F2', label: 'Facebook' },
    },
    {
      test: (h) =>
        h === 'x.com' ||
        h.endsWith('.x.com') ||
        h.includes('twitter.') ||
        h.includes('t.co'),
      icon: { Icon: FaXTwitter, color: '#000000', label: 'X' },
    },
    {
      test: (h) => h.includes('linkedin.') || h.includes('lnkd.in'),
      icon: { Icon: FaLinkedin, color: '#0A66C2', label: 'LinkedIn' },
    },
    {
      test: (h) => h.includes('youtube.') || h.includes('youtu.be'),
      icon: { Icon: FaYoutube, color: '#FF0000', label: 'YouTube' },
    },
    {
      test: (h) => h.includes('tiktok.'),
      icon: { Icon: FaTiktok, color: '#000000', label: 'TikTok' },
    },
    {
      test: (h) => h.includes('whatsapp.') || h === 'wa.me' || h.includes('api.whatsapp'),
      icon: { Icon: FaWhatsapp, color: '#25D366', label: 'WhatsApp' },
    },
    {
      test: (h) => h.includes('snapchat.'),
      icon: { Icon: FaSnapchat, color: '#FFFC00', label: 'Snapchat' },
    },
    {
      test: (h) => h.includes('pinterest.'),
      icon: { Icon: FaPinterest, color: '#BD081C', label: 'Pinterest' },
    },
    {
      test: (h) => h.includes('t.me') || h.includes('telegram.'),
      icon: { Icon: FaTelegram, color: '#26A5E4', label: 'Telegram' },
    },
    {
      test: (h) => h.includes('maps.') || h.includes('goo.gl/maps') || h.includes('maps.app.goo'),
      icon: { Icon: FaLocationDot, color: '#EA4335', label: 'Map' },
    },
    // Online menu services, or any URL whose path looks like a menu.
    {
      test: (h, p) =>
        h.includes('menu') ||
        h.includes('zomato.') ||
        h.includes('thefork.') ||
        h.includes('elmenus.') ||
        p.includes('menu'),
      icon: { Icon: FaUtensils, color: '#5B4FCF', label: 'Menu' },
    },
  ]

const GENERIC_WEBSITE: LinkIcon = {
  Icon: FaGlobe,
  color: '#0f9e6e',
  label: 'Website',
}
const FALLBACK: LinkIcon = { Icon: FaLink, color: '#6b7280', label: 'Link' }

/**
 * Pick the icon for a link URL based on its host (and path). Returns a globe for
 * a plain website, a brand icon for a recognized platform, and a generic link
 * icon if the URL can't be parsed at all.
 */
export function linkIconFor(rawUrl: string): LinkIcon {
  const url = rawUrl.trim()
  if (!url) return FALLBACK
  let parsed: URL
  try {
    // Tolerate URLs the user typed without a scheme (e.g. "instagram.com/x").
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
  } catch {
    return FALLBACK
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const path = parsed.pathname.toLowerCase()
  for (const rule of RULES) {
    if (rule.test(host, path)) return rule.icon
  }
  // Parsed fine but no platform matched → treat as a website.
  return GENERIC_WEBSITE
}

/**
 * Normalize a user-typed link into an href with a scheme, so the anchor opens
 * correctly even if they typed "instagram.com/foo".
 */
export function normalizeUrl(rawUrl: string): string {
  const url = rawUrl.trim()
  if (!url) return ''
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}
