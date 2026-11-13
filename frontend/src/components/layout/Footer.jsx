import { Link } from "react-router-dom";
import { FOOTER_LINKS } from "../../data/navigation";
import SocialLinks from "../ui/SocialLinks";
import Logo from "../ui/Logo";

const APP_STORES = [
  { href: "https://www.apple.com/app-store/", icon: "/images/footer/apple.png", small: "Download on the", big: "App Store" },
  { href: "https://play.google.com/store", icon: "/images/footer/play.png", small: "GET IT ON", big: "Google Play" },
];

/**
 * variant:
 *  - default: app badges, links, copyright + socials (most pages)
 *  - forex: as default with extra floating shapes
 *  - crypto: socials under the intro, centred copyright, extra top space for the overlapping CTA
 *  - platform: lime/blue accents on a lighter dark background
 */
export default function Footer({ variant = "default" }) {
  const platform = variant === "platform";
  const crypto = variant === "crypto";
  const hoverText = platform ? "hover:text-bg-10" : "hover:text-brand";
  const appColors = platform ? ["bg-bg-10 text-ink", "bg-tertiary-4 text-white"] : ["bg-brand text-ink", "bg-bg-8 text-white"];

  return (
    <footer className={`relative overflow-hidden font-normal text-wh ${platform ? "bg-bg-12" : "bg-footer-bg"}`}>
      <div className="container">
        <div className="relative z-2">
          <div
            className={
              crypto
                ? "pb-20 pt-50 sm:pb-22.5 sm:pt-62.5 lg:pb-25 lg:pt-83"
                : "py-20 sm:py-22.5 lg:py-25"
            }
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 md:grid-cols-12">
              <div className={`col-span-2 sm:col-span-3 ${crypto ? "md:col-span-5 lg:col-span-6" : "md:col-span-6"}`}>
                <Link to="/" className="mb-5 inline-block" aria-label="FinSight home">
                  <Logo tone="light" />
                </Link>
                <p className="mb-7.5 text-text-2 md:mb-8 md:max-w-[40ch]">
                  Welcome to our trading site! We offer the best, most affordable products and services around. Shop now
                  and start finding great deals!
                </p>
                {crypto ? (
                  <SocialLinks variant="light" activeFirst />
                ) : (
                  <div className="flex flex-wrap items-center gap-5">
                    {APP_STORES.map((app, i) => (
                      <a
                        key={app.big}
                        href={app.href}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 pb-2.5 pt-1.25 hover:opacity-90 ${appColors[i]}`}
                      >
                        <img src={app.icon} alt="" />
                        <span className="leading-[1.1]">
                          <span className="block text-[0.5rem]">{app.small}</span>
                          <span className="block text-sm">{app.big}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {FOOTER_LINKS.map((group, i) => (
                <div
                  key={group.title}
                  className={`${i === 2 ? "col-span-2 sm:col-span-1" : ""} ${crypto && i === 1 ? "md:col-span-3 lg:col-span-2" : "md:col-span-2"}`}
                >
                  <h6 className="mb-3 text-white sm:mb-5">{group.title}</h6>
                  <ul>
                    {group.links.map((link) => (
                      <li key={link.label} className="not-last:mb-2.5">
                        <Link
                          to={link.to}
                          className={`relative inline-block text-text-2 after:absolute after:left-0 after:top-1/2 after:h-0.5 after:w-2.5 after:-translate-y-1/2 after:bg-current after:opacity-0 after:transition-all after:duration-300 after:content-[''] hover:translate-x-2.5 hover:after:-left-3 hover:after:opacity-100 ${hoverText}`}
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div
            className={`flex flex-col gap-5 border-t border-white/10 py-6.25 text-text-2 sm:flex-row sm:items-center ${
              crypto ? "sm:justify-center" : "sm:justify-between"
            }`}
          >
            <p className="mb-0">
              © {new Date().getFullYear()} All Rights Reserved By{" "}
              <Link to="/" className={`font-semibold ${platform ? "text-bg-10" : "text-brand"}`}>
                FinSight
              </Link>
            </p>
            {!crypto && <SocialLinks variant={platform ? "lime" : "light"} />}
          </div>
        </div>
      </div>

      <div aria-hidden="true">
        {crypto ? (
          <span className="absolute left-[57%] top-[21%] max-w-12.5 animate-left-right sm:left-[40%] sm:top-[29%] sm:max-w-none md:left-[30%] md:top-[80%] lg:left-1/4 lg:top-[45%] xl:left-[22%] 2xl:left-[26%] 3xl:left-[32%]">
            <img src="/images/footer/1.png" alt="" />
          </span>
        ) : (
          <>
            <span className="absolute left-1/2 top-[8%] max-w-15 animate-left-right sm:left-[40%] sm:top-[12%] sm:max-w-none md:left-[5%] md:top-[70%] lg:left-[27%] lg:top-[17%] xl:left-[23%] 2xl:left-[33%]">
              <img src="/images/footer/1.png" alt="" />
            </span>
            <span className="absolute hidden h-[95%] w-132.5 rotate-13 rounded-r-[40px] border border-white p-10 opacity-[0.06] md:left-[-19%] md:top-0 md:block lg:left-[-11%] lg:top-[4%] xl:left-[-6%] xl:top-[9%] xl:h-full 2xl:left-[-26%] 2xl:top-0 2xl:h-[101%] 2xl:w-230 3xl:-left-[3%] 3xl:h-[107%]">
              <span className="absolute left-[-77%] top-[5%] h-[90%] w-225 rounded-r-[40px] bg-[linear-gradient(150.39deg,rgba(237,242,248,0.22)_15.02%,#EDF2F8_99.59%)] 2xl:left-[-1%]" />
            </span>
          </>
        )}
        {(variant === "forex" || platform) && (
          <>
            <span className="absolute left-[57%] top-[21%] hidden max-w-12.5 animate-rotate sm:left-[40%] sm:top-[29%] sm:max-w-none md:left-[30%] md:top-[15%] md:block lg:left-[3%] lg:top-[66%] 2xl:top-[58%] 3xl:left-[13%] 3xl:top-[63%]">
              <img src="/images/icon/shape/2.png" alt="" />
            </span>
            <span className="absolute left-[43%] top-[60%] w-17.5 animate-floating sm:left-[65%] sm:top-[29%] md:left-[43%] md:top-[60%] md:w-auto lg:top-[56%] xl:left-[40%] xl:top-1/2 2xl:left-[36%] 3xl:left-[46%] 3xl:top-[54%]">
              <img src="/images/icon/shape/1.png" alt="" />
            </span>
          </>
        )}
      </div>
    </footer>
  );
}
