import React from "react";
import { FileSearch, MessagesSquare, Presentation } from "lucide-react";
import FormPage from "../components/ui/FormPage";
import TutorApplicationForm from "../components/forms/TutorApplicationForm";

const STEPS = [
  { Icon: FileSearch, title: "Application review", text: "Our academic team reviews your profile, subjects and experience." },
  { Icon: MessagesSquare, title: "Interview & demo", text: "A short conversation and a sample lesson so we can see your teaching style." },
  { Icon: Presentation, title: "Start teaching", text: "Get matched with students and teach live online classes on your own schedule." },
];

const JoinTutor = () => (
  <FormPage
    image="https://images.unsplash.com/photo-1616587226960-4a03badbe8bf?auto=format&fit=crop&w=1920&q=70"
    imagePosition="30% 40%"
    eyebrow="Careers"
    title="Teach with"
    highlight="Silora Academy."
    subtitle="Join our growing global network of tutors and help students learn with confidence — from anywhere."
    points={[
      "Teach students across 12+ international boards",
      "Choose your own hours and work from home",
      "Supportive academic team and ready resources",
      "Regular students matched to your subjects",
    ]}
    formTitle="Apply as a tutor"
    formSubtitle="Tell us about yourself and upload your resume."
    stepsTitle="How joining works"
    steps={STEPS}
  >
    <TutorApplicationForm />
  </FormPage>
);

export default JoinTutor;
