import React, { useRef, useState } from "react";
import { Mail, Globe, Phone, Send, ArrowDown, GraduationCap, Clock, BookOpenCheck } from "lucide-react";
import { FaFacebookF, FaInstagram, FaWhatsapp, FaTelegram } from "react-icons/fa6";
import { API_BASE_URL } from "../config";
import { SITE, SOCIAL_LINKS, WHATSAPP_URL } from "../data/site";
import { Container } from "../components/ui/Section";
import LightHero from "../components/ui/LightHero";
import { Field } from "../components/ui/Fields";
import Alert from "../components/ui/Alert";
import { btn, inputClass } from "../components/ui/styles";

// Small trust chips under the hero buttons (no contact details in the hero)
const TRUST_CHIPS = [
  [GraduationCap, "Free demo class"],
  [Clock, "Reply within a day"],
  [BookOpenCheck, "All major boards"],
];

// ============================================================
// CONTACT CHANNELS
// ============================================================

const CHANNELS = [
  { Icon: Mail, title: "Email", value: SITE.email, href: `mailto:${SITE.email}` },
  { Icon: Phone, title: "Phone / WhatsApp", value: SITE.phone, href: SITE.phoneHref },
  { Icon: Globe, title: "Website", value: SITE.website, href: SITE.websiteHref },
];

const SOCIALS = [
  { href: SOCIAL_LINKS.facebook, label: "Facebook", Icon: FaFacebookF },
  { href: SOCIAL_LINKS.instagram, label: "Instagram", Icon: FaInstagram },
  { href: SOCIAL_LINKS.whatsapp, label: "WhatsApp", Icon: FaWhatsapp },
  { href: SOCIAL_LINKS.telegram, label: "Telegram", Icon: FaTelegram },
];

// ============================================================
// PAGE
// ============================================================

const Contact = () => {
  const form = useRef();
  // status: "" | "sending" | "success" | "error"
  const [status, setStatus] = useState("");

  const sendEmail = async (e) => {
    e.preventDefault();
    setStatus("sending");

    try {
      const formData = new FormData(form.current);
      const res = await fetch(`${API_BASE_URL}/api/contact`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        setStatus("success");
        form.current.reset();
      } else {
        setStatus("error");
      }
    } catch (error) {
      console.error("Error:", error);
      setStatus("error");
    }
  };

  return (
    <div className="bg-white">
      {/* ===================== HERO (centered + photo strip) ===================== */}
      <LightHero
        eyebrow="Contact us"
        title="Start your"
        highlight="learning journey"
        subtitle="We are here to help you learn better and grow stronger. Get in touch with us today."
        actions={
          <>
            <a href="#contact-form" className={btn("primary", "lg", "w-full sm:w-auto")}>
              Send a message <ArrowDown className="h-4 w-4" />
            </a>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={btn("outline", "lg", "w-full sm:w-auto")}>
              <FaWhatsapp className="h-4 w-4 text-[#25D366]" /> Chat on WhatsApp
            </a>
          </>
        }
      >
        {/* Phones: three equal tiles side by side (icon over label). Larger screens: a row of pills. */}
        <ul className="mx-auto grid max-w-md grid-cols-3 gap-2 sm:flex sm:max-w-none sm:flex-wrap sm:items-center sm:justify-center sm:gap-3">
          {TRUST_CHIPS.map(([Icon, label]) => (
            <li
              key={label}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-white px-2 py-3.5 text-center text-xs font-semibold leading-snug text-navy shadow-sm sm:inline-flex sm:flex-row sm:gap-2 sm:rounded-full sm:px-4 sm:py-2 sm:text-sm sm:font-medium"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft sm:h-auto sm:w-auto sm:bg-transparent">
                <Icon className="h-4 w-4 text-brand-hover" />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </LightHero>

      <section id="contact-form" className="scroll-mt-16 py-14 sm:py-16 lg:py-24">
        <Container>
          <div className="grid gap-4 lg:grid-cols-12">
            {/* Contact info – navy panel */}
            <div className="relative overflow-hidden rounded-[2rem] bg-navy p-6 sm:p-10 lg:col-span-5">
              <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/20 blur-[90px]" />
              <h2 className="relative text-3xl font-bold !text-white sm:text-4xl">Get in touch</h2>
              <p className="relative mt-3 text-slate-300">
                We'd love to hear from you. Reach out through any of these channels.
              </p>

              <div className="relative mt-8 space-y-3">
                {CHANNELS.map(({ Icon, title, value, href }) => (
                  <a
                    key={title}
                    href={href}
                    target={href.startsWith("http") ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className="group flex items-center gap-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 transition hover:bg-white/10 hover:ring-brand/50"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand">
                      <Icon className="h-5 w-5 text-navy" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium uppercase tracking-wider text-slate-400">{title}</span>
                      <span className="block truncate font-medium text-white">{value}</span>
                    </span>
                  </a>
                ))}
              </div>

              <div className="relative mt-10 border-t border-white/10 pt-6">
                <h3 className="text-xs font-semibold uppercase tracking-wider !text-slate-400">Follow us</h3>
                <div className="mt-3 flex gap-2">
                  {SOCIALS.map(({ href, label, Icon }) => (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-300 ring-1 ring-white/10 transition hover:bg-brand hover:text-navy hover:ring-brand"
                    >
                      <Icon size={15} />
                    </a>
                  ))}
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="lg:col-span-7">
              <form
                ref={form}
                onSubmit={sendEmail}
                className="h-full rounded-[2rem] border border-line bg-surface p-6 sm:p-10"
              >
                <h2 className="text-3xl font-bold sm:text-4xl">Send us a message</h2>
                <p className="mt-1 text-sm text-muted">We usually reply within one working day.</p>

                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <Field label="Name" htmlFor="user_name">
                    <input id="user_name" name="user_name" type="text" required placeholder="Your name" className={inputClass} />
                  </Field>
                  <Field label="Email" htmlFor="user_email">
                    <input id="user_email" name="user_email" type="email" required placeholder="you@example.com" className={inputClass} />
                  </Field>
                  <Field label="Phone (optional)" htmlFor="user_phone" className="sm:col-span-2">
                    <input id="user_phone" name="user_phone" type="tel" placeholder="Your phone number" className={inputClass} />
                  </Field>
                  <Field label="Message" htmlFor="message" className="sm:col-span-2">
                    <textarea
                      id="message"
                      name="message"
                      rows="5"
                      required
                      placeholder="How can we help you?"
                      className={`${inputClass} resize-y`}
                    />
                  </Field>
                </div>

                {status === "success" && (
                  <div className="mt-5"><Alert type="success">Message sent successfully! We'll get back to you soon.</Alert></div>
                )}
                {status === "error" && (
                  <div className="mt-5"><Alert type="error">Failed to send message. Please try again.</Alert></div>
                )}

                <button type="submit" disabled={status === "sending"} className={btn("primary", "lg", "mt-6 w-full sm:w-auto")}>
                  {status === "sending" ? "Sending…" : "Send message"}
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
};

export default Contact;
