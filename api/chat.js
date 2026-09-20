const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  // Allow browser requests from ThattalkingGuy...
  const allowedOrigins = [
    "https://thattalkingguy.com",
    "https://www.thattalkingguy.com",
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method Not Allowed",
    });
  }

  try {
    const {
      question,
      conversation = [],
      visitor = {},
    } = req.body || {};

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        success: false,
        error: "Question is required.",
      });
    }

    // Load Gemini without exposing the API key to the browser.
    const { GoogleGenAI } = await import("@google/genai");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const systemInstruction = `
You are Sharon, the AI Client Assistant for ThattalkingGuy...

Your role is to:
1. Help visitors understand what ThattalkingGuy... offers.
2. Understand what the visitor is trying to accomplish.
3. Identify genuine business opportunities.
4. Qualify potential clients naturally.
5. Collect useful project information without being pushy.
6. Identify existing-client issues and requests for the owner.
7. Alert the owner when human attention is appropriate.

IMPORTANT IDENTITY RULE:
You are Sharon.
You are NOT the owner.
Never pretend to be the owner.
Never claim that you personally build, deliver, approve, quote, or guarantee a project.

AVAILABLE SERVICES:

1. AI-Powered Websites
2. Ecommerce Systems
3. Multi-Vendor Marketplaces
4. Digital Product Platforms
5. Business Automation
6. Custom Web Applications
7. Digital Business Consulting

PERSONALITY:
- Friendly
- Professional
- Intelligent
- Helpful
- Natural
- Concise
- Confident but not pushy
- Conversational

CLIENT QUALIFICATION:

When a visitor appears interested in hiring ThattalkingGuy..., naturally try to understand:

- Full name
- Email
- WhatsApp/phone
- Service needed
- What they want to build
- Budget
- Timeline

Do NOT ask for all information at once unless the visitor clearly wants to submit a project.

Instead, have a natural conversation.

Example:

Visitor:
"I need an ecommerce website."

Good response:
"Absolutely. I can help you explore that. What kind of products will you be selling, and do you already have a website or are we starting from scratch?"

Then continue gathering useful information.

If the visitor gives information voluntarily, preserve it.

If information is missing, leave it blank.

NEVER invent:
- Names
- Emails
- Phone numbers
- Budgets
- Timelines
- Project details

INTENT CLASSIFICATION:

Use exactly one of:

general
potential_client
existing_client
pending_job
owner_attention

Use "general" for:
- Casual conversation
- General questions
- Questions about ThattalkingGuy...
- Questions about services without clear buying intent

Use "potential_client" when:
- The visitor appears interested in hiring
- They describe a project they want built
- They ask about getting started
- They ask for a quote/proposal
- They ask about pricing for a project

Use "existing_client" when:
- They indicate they already have a project with ThattalkingGuy...
- They have a problem with an existing job
- They need an update on an existing project

Use "pending_job" when:
- The visitor refers to an unfinished job
- A previously discussed project needs follow-up
- A project appears to require owner action

Use "owner_attention" when:
- The visitor specifically asks to speak to the owner
- The visitor requests something Sharon cannot properly handle
- A sensitive or unusual client issue requires human attention

NEEDS ATTENTION:

Set needs_attention to true when:
- A visitor appears ready to hire
- A visitor requests a quote or proposal
- A visitor wants to start a project
- A visitor provides meaningful project information
- An existing client reports an issue
- A visitor asks to speak directly with the owner
- A project appears to require follow-up
- The conversation contains enough information to make useful human follow-up possible

Set needs_attention to false for:
- Casual conversation
- Ordinary informational questions
- General browsing

IMPORTANT:
Do not tell the visitor that an email has definitely been sent.
You may say that you can flag the request for attention.

PRICING:
Do not invent prices.
Do not guarantee discounts.
Do not promise delivery dates.
Do not guarantee project results.

OWNER REQUESTS:

If a visitor asks:
"Can I speak to the owner?"
"Is the owner available?"
"I need the owner."

Respond naturally and explain that you can collect their details and flag the request for attention.

LEAD DATA:

Return the best information currently known.

The lead object must always contain:

{
  "name": "",
  "email": "",
  "phone": "",
  "service": "",
  "budget": "",
  "timeline": "",
  "project": ""
}

If the visitor has not provided a field, leave it blank.

OUTPUT:

Your response MUST be valid JSON with exactly these top-level fields:

{
  "answer": "Natural response to the visitor",
  "intent": "general|potential_client|existing_client|pending_job|owner_attention",
  "needs_attention": true,
  "lead": {
    "name": "",
    "email": "",
    "phone": "",
    "service": "",
    "budget": "",
    "timeline": "",
    "project": ""
  }
}

Do not include Markdown.
Do not include code fences.
Do not include explanations outside the JSON.
`;

    const historyText = Array.isArray(conversation)
      ? conversation
          .slice(-12)
          .map((item) => {
            const role = item.role || "user";
            const content = item.content || "";
            return `${role}: ${content}`;
          })
          .join("\n")
      : "";

    const visitorText = `
KNOWN VISITOR INFORMATION:

Name:
${visitor.name || "Not provided"}

Email:
${visitor.email || "Not provided"}

Phone:
${visitor.phone || "Not provided"}

RECENT CONVERSATION:

${historyText}

NEW VISITOR MESSAGE:

${question}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      config: {
        systemInstruction,
        responseMimeType: "application/json",
      },
      contents: visitorText,
    });

    let result;

    try {
      result = JSON.parse(response.text);
    } catch {
      result = {
        answer: response.text,
        intent: "general",
        needs_attention: false,
        lead: {
          name: visitor.name || "",
          email: visitor.email || "",
          phone: visitor.phone || "",
          service: "",
          budget: "",
          timeline: "",
          project: "",
        },
      };
    }

    // Ensure the expected structure always exists.
    if (!result.lead || typeof result.lead !== "object") {
      result.lead = {};
    }

    const lead = result.lead;

    // Preserve information supplied directly by the visitor.
    lead.name = lead.name || visitor.name || "";
    lead.email = lead.email || visitor.email || "";
    lead.phone = lead.phone || visitor.phone || "";
    lead.service = lead.service || "";
    lead.budget = lead.budget || "";
    lead.timeline = lead.timeline || "";
    lead.project = lead.project || "";

    result.lead = lead;

    // Normalize intent.
    const allowedIntents = [
      "general",
      "potential_client",
      "existing_client",
      "pending_job",
      "owner_attention",
    ];

    if (!allowedIntents.includes(result.intent)) {
      result.intent = "general";
    }

    result.needs_attention = Boolean(result.needs_attention);

    /*
     * OWNER EMAIL NOTIFICATION
     *
     * Sharon only sends an email when human attention is required.
     */
    if (result.needs_attention === true) {
      const ownerEmail =
        process.env.OWNER_EMAIL || "hello@thattalkingguy.com";

      const fromEmail =
        process.env.FROM_EMAIL || "Sharon <onboarding@resend.dev>";

      let subject = "Sharon: ThattalkingGuy... Attention Required";

      if (result.intent === "potential_client") {
        subject = "Sharon: New Potential Client";
      }

      if (result.intent === "pending_job") {
        subject = "Sharon: Pending Job Needs Attention";
      }

      if (result.intent === "existing_client") {
        subject = "Sharon: Existing Client Needs Attention";
      }

      if (result.intent === "owner_attention") {
        subject = "Sharon: Visitor Requests Owner Attention";
      }

      const emailHtml = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222">

          <h2>${escapeHtml(subject)}</h2>

          <p>
            Sharon has identified a conversation that may require
            attention from ThattalkingGuy...
          </p>

          <hr>

          <h3>Sharon's Assessment</h3>

          <p>
            ${escapeHtml(result.answer || "")}
          </p>

          <h3>Lead / Client Information</h3>

          <p>
            <strong>Name:</strong>
            ${escapeHtml(lead.name || "Not provided")}
          </p>

          <p>
            <strong>Email:</strong>
            ${escapeHtml(lead.email || "Not provided")}
          </p>

          <p>
            <strong>Phone / WhatsApp:</strong>
            ${escapeHtml(lead.phone || "Not provided")}
          </p>

          <p>
            <strong>Service:</strong>
            ${escapeHtml(lead.service || "Not identified")}
          </p>

          <p>
            <strong>Budget:</strong>
            ${escapeHtml(lead.budget || "Not provided")}
          </p>

          <p>
            <strong>Timeline:</strong>
            ${escapeHtml(lead.timeline || "Not provided")}
          </p>

          <p>
            <strong>Project:</strong>
            ${escapeHtml(lead.project || "Not provided")}
          </p>

          <hr>

          <p>
            <strong>Intent:</strong>
            ${escapeHtml(result.intent || "unknown")}
          </p>

          <p>
            <strong>Needs Attention:</strong>
            Yes
          </p>

          <hr>

          <p style="font-size:12px;color:#666">
            This notification was generated by Sharon,
            the AI Client Assistant for ThattalkingGuy...
          </p>

        </div>
      `;

      try {
        await resend.emails.send({
          from: fromEmail,
          to: ownerEmail,
          subject,
          html: emailHtml,
        });
      } catch (emailError) {
        console.error(
          "Sharon email notification error:",
          emailError
        );
      }
    }

    return res.status(200).json({
      success: true,
      answer: result.answer || "How can I help you?",
      intent: result.intent || "general",
      needs_attention: Boolean(result.needs_attention),
      lead: result.lead,
    });
  } catch (error) {
    console.error("Sharon Error:", error);

    return res.status(500).json({
      success: false,
      error: "Sharon is temporarily unavailable. Please try again.",
    });
  }
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}