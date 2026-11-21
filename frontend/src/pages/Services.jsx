import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Container } from "../components/ui/Section";
import LightHero from "../components/ui/LightHero";
import CTASection from "../components/ui/CTASection";
import { btn, cardClass } from "../components/ui/styles";


// ============================================================
// SERVICES DATA
// ============================================================

const servicesData = [
  {
    id: 101,
    category: "Tutoring Formats",
    title: "One-on-One Tutoring",
    description:
      "Personalized, private sessions tailored to the student's unique learning style, pace, and academic goals.",
    image:
      "https://images.unsplash.com/photo-1544531586-fde5298cdd40?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 102,
    category: "Tutoring Formats",
    title: "Group Tutoring",
    description:
      "Collaborative small group classes that foster peer learning, discussion, and healthy competition.",
    image:
      "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 103,
    category: "Tutoring Formats",
    title: "Online Tutoring",
    description:
      "Flexible, high-quality virtual lessons accessible from the comfort of your home, anywhere in the world.",
    image:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80",
  },

  {
    id: 201,
    category: "Specialized Learning Services",
    title: "Exam Preparation",
    description:
      "Targeted coaching for board exams (CBSE, ICSE, IGCSE, IB).",
    image:
      "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 202,
    category: "Specialized Learning Services",
    title: "Homework Help",
    description:
      "Daily assistance with school assignments to ensure concepts are understood and work is completed on time.",
    image:
      "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 203,
    category: "Specialized Learning Services",
    title: "Language Learning",
    description:
      "Courses designed to improve reading, writing, and speaking skills in English and other languages.",
    image:
      "https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 204,
    category: "Specialized Learning Services",
    title: "Skill Development",
    description:
      "Workshops and courses focused on critical thinking, coding, public speaking, and other essential life skills.",
    image:
      "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80",
  },

  {
    id: 301,
    category: "Virtual Classroom Tools",
    title: "Live Video Classes",
    description:
      "High-definition video sessions that replicate the in-classroom experience with real-time interaction.",
    image:
      "https://images.unsplash.com/photo-1610484826967-09c5720778c7?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 302,
    category: "Virtual Classroom Tools",
    title: "Screen Sharing",
    description:
      "Effortlessly collaborate on documents, presentations, or share textbook content in real-time.",
    image:
      "https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 303,
    category: "Virtual Classroom Tools",
    title: "Interactive Whiteboard",
    description:
      "A shared digital canvas for live explanations, drawing complex diagrams, and solving problems together.",
    image:
      "https://images.unsplash.com/photo-1560785496-3c9d27877182?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 304,
    category: "Virtual Classroom Tools",
    title: "Online Tests & Quizzes",
    description:
      "Regular assessments and quizzes built into the platform to track progress and gauge understanding immediately.",
    image:
      "https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?auto=format&fit=crop&w=600&q=80",
  },

  {
    id: 401,
    category: "Tutor & Scheduling Features",
    title: "Detailed Tutor Profiles",
    description:
      "View comprehensive information including qualifications, experience, and student ratings before you book a session.",
    image:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=100",
  },
  {
    id: 402,
    category: "Tutor & Scheduling Features",
    title: "Easy Booking System",
    description:
      "Schedule your one-on-one or group sessions instantly and seamlessly via our intuitive online booking platform.",
    image:
      "https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 403,
    category: "Tutor & Scheduling Features",
    title: "Flexible Timings",
    description:
      "Access tutors available across various time zones to fit any student schedule, anywhere in the world.",
    image:
      "https://images.unsplash.com/photo-1495364141860-b0d03eccd065?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 404,
    category: "Tutor & Scheduling Features",
    title: "Trial Classes",
    description:
      "A first class that is either completely free or discounted, allowing you to experience our service risk-free.",
    image:
      "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=600&q=80",
  },

  {
    id: 501,
    category: "Additional Services",
    title: "Parent-Teacher Reports",
    description:
      "Receive regular, detailed updates on your student's progress, areas of improvement, and session performance.",
    image:
      "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 502,
    category: "Additional Services",
    title: "Career Guidance & Counselling",
    description:
      "Expert guidance for long-term academic planning and making informed decisions about future career paths.",
    image:
      "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 503,
    category: "Additional Services",
    title: "Workshops & Webinars",
    description:
      "Specialized sessions on topics like advanced study skills, motivation, exam tips, and subject deep dives.",
    image:
      "https://images.unsplash.com/photo-1591115765373-5207764f72e7?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: 504,
    category: "Additional Services",
    title: "24/7 Chat Support",
    description:
      "Instant, round-the-clock help for quick questions, technical issues, and scheduling assistance.",
    image:
      "https://images.unsplash.com/photo-1553775282-20af80779df7?auto=format&fit=crop&w=600&q=80",
  },];

const categories = [
  "Tutoring Formats",
  "Specialized Learning Services",
  "Virtual Classroom Tools",
  "Tutor & Scheduling Features",
  "Additional Services",
];

// ============================================================
// SERVICE CARD
// ============================================================

const ServiceCard = ({ service, index }) => (
  <article className={`${cardClass} group flex flex-col overflow-hidden p-2`}>
    <div className="relative aspect-[4/3] overflow-hidden rounded-[1.5rem] bg-slate-100">
      <img
        className={`h-full w-full object-cover transition-transform duration-700 group-hover:scale-105 ${service.id === 401 ? "object-[50%_20%]" : ""}`}
        src={service.image}
        alt={service.title}
        loading="lazy"
        decoding="async"
      />
      <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-navy backdrop-blur">
        {String(index + 1).padStart(2, "0")}
      </span>
    </div>
    <div className="flex flex-1 flex-col px-4 pb-4 pt-5">
      <h3 className="text-lg font-semibold">{service.title}</h3>
      <p className="mt-2 flex-1 text-[15px] leading-relaxed text-slate-500">{service.description}</p>
      <Link
        to="/book-demo"
        className="mt-5 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-navy transition-colors hover:text-brand-hover"
      >
        Book a free demo
        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </Link>
    </div>
  </article>
);

// ============================================================
// PAGE
// ============================================================

const ServicesPage = () => {
  const [activeCategory, setActiveCategory] = useState(categories[0]);

  const filteredServices = servicesData.filter((service) => service.category === activeCategory);

  return (
    <div className="bg-white">
      {/* ===================== HERO (centered + category chips) ===================== */}
      <LightHero
        eyebrow="Our services"
        title="Designed for"
        highlight="confident learning"
        subtitle="Discover flexible, personalized tutoring options built to fit every student's pace, goals, and board of education."
        actions={
          <Link to="/book-demo" className={btn("primary", "lg", "w-full sm:w-auto")}>
            Book a free demo <ArrowRight className="h-4 w-4" />
          </Link>
        }
      >
        <p className="text-sm font-medium text-slate-500">Choose a category</p>
        {/* Phones: an even, full-width list (name left, count right). Larger screens: centred chips. */}
        <div role="tablist" aria-label="Service categories" className="mx-auto mt-4 grid max-w-sm grid-cols-1 gap-2 sm:flex sm:max-w-5xl sm:flex-wrap sm:justify-center">
          {categories.map((category) => {
            const active = activeCategory === category;
            const count = servicesData.filter((s) => s.category === category).length;
            return (
              <button
                key={category}
                role="tab"
                aria-selected={active}
                aria-controls="services"
                onClick={() => setActiveCategory(category)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all duration-200 sm:inline-flex sm:w-auto sm:justify-center sm:whitespace-nowrap sm:rounded-full sm:py-2.5 ${
                  active ? "border-navy bg-navy text-white shadow-md" : "border-line bg-white text-slate-600 hover:border-slate-300 hover:text-navy"
                }`}
              >
                <span className="min-w-0">{category}</span>
                <span className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${active ? "bg-brand text-navy" : "bg-surface text-slate-400"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </LightHero>

      <section id="services" className="scroll-mt-24 pb-14 pt-2 sm:pb-16 lg:pb-24">
        <Container>
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-sm font-medium text-slate-400">
                {categories.indexOf(activeCategory) + 1} / {categories.length}
              </p>
              <h2 className="mt-1 text-3xl font-bold sm:text-4xl">{activeCategory}</h2>
            </div>
          </div>

          {/* Grid – fills the full width whether a category has 3 or 4 services */}
          <div
            key={activeCategory}
            className={`animate-fadeIn mt-10 grid gap-4 sm:grid-cols-2 ${
              filteredServices.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"
            }`}
          >
            {filteredServices.map((service, i) => (
              <ServiceCard key={service.id} service={service} index={i} />
            ))}
          </div>
        </Container>
      </section>

      <CTASection />
    </div>
  );
};

export default ServicesPage;
