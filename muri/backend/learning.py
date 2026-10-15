"""Learning, gamification and note-taking for Muri ("Learn. Play. Grow.").

Everything here is additive: streaks, badges, notes, courses/lessons,
certificates and mini-games exposed through ``/api/learn`` and ``/api/notes``.
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from auth import read_user_settings, require_user, write_user_settings
from db import SessionLocal
from models import (
    BadgeAward,
    Certificate,
    ChatSession,
    Course,
    GameScore,
    Lesson,
    LessonProgress,
    Note,
    User,
    UserStat,
)

router = APIRouter(tags=["learning"])

CATALOG_DEFAULTS = {
    "goal": "",
    "level": "Beginner",
    "daily_minutes": "10",
    "onboarded": "0",
}


# --------------------------------------------------------------------------- #
# Achievement definitions
# --------------------------------------------------------------------------- #
BADGES: List[dict] = [
    {
        "id": "first_chat",
        "title": "First Words",
        "description": "Send your first message to Muri",
        "icon": "chat",
        "check": lambda m: m["messages"] >= 1,
    },
    {
        "id": "streak_3",
        "title": "Warming Up",
        "description": "Reach a 3-day learning streak",
        "icon": "flame",
        "check": lambda m: m["longest_streak"] >= 3,
    },
    {
        "id": "streak_7",
        "title": "On Fire",
        "description": "Reach a 7-day learning streak",
        "icon": "flame",
        "check": lambda m: m["longest_streak"] >= 7,
    },
    {
        "id": "streak_30",
        "title": "Unstoppable",
        "description": "Reach a 30-day learning streak",
        "icon": "flame",
        "check": lambda m: m["longest_streak"] >= 30,
    },
    {
        "id": "first_note",
        "title": "Note Taker",
        "description": "Save your first note",
        "icon": "note",
        "check": lambda m: m["notes"] >= 1,
    },
    {
        "id": "notes_10",
        "title": "Scholar",
        "description": "Save 10 notes",
        "icon": "note",
        "check": lambda m: m["notes"] >= 10,
    },
    {
        "id": "first_lesson",
        "title": "Getting Started",
        "description": "Complete your first lesson",
        "icon": "book",
        "check": lambda m: m["lessons"] >= 1,
    },
    {
        "id": "lessons_10",
        "title": "Deep Learner",
        "description": "Complete 10 lessons",
        "icon": "book",
        "check": lambda m: m["lessons"] >= 10,
    },
    {
        "id": "first_course",
        "title": "Course Complete",
        "description": "Finish your first course",
        "icon": "cert",
        "check": lambda m: m["courses"] >= 1,
    },
    {
        "id": "game_first",
        "title": "Play Time",
        "description": "Play your first game",
        "icon": "game",
        "check": lambda m: m["games"] >= 1,
    },
    {
        "id": "game_perfect",
        "title": "Perfect Score",
        "description": "Answer every question correctly in a game",
        "icon": "game",
        "check": lambda m: m["perfect"] >= 1,
    },
    {
        "id": "points_100",
        "title": "Century",
        "description": "Earn 100 points",
        "icon": "star",
        "check": lambda m: m["points"] >= 100,
    },
]

_BADGE_BY_ID = {badge["id"]: badge for badge in BADGES}


def badge_catalog() -> List[dict]:
    return [
        {
            "id": badge["id"],
            "title": badge["title"],
            "description": badge["description"],
            "icon": badge["icon"],
        }
        for badge in BADGES
    ]


# --------------------------------------------------------------------------- #
# Seed course catalog
# --------------------------------------------------------------------------- #
COURSE_SEED: List[dict] = [
    {
        "id": "digital-literacy",
        "title": "Digital Literacy",
        "emoji": "💡",
        "category": "Everyday Skills",
        "level": "Beginner",
        "description": "Get confident online — from the basics of the internet to staying safe.",
        "lessons": [
            {
                "id": "dl-1",
                "title": "How the internet works",
                "summary": "A plain-language tour of browsers, websites and search.",
                "minutes": 5,
                "content": (
                    "The internet is a network of computers that talk to each other.\n\n"
                    "**Key ideas**\n"
                    "- A *browser* (Chrome, Edge, Safari) is the app you use to visit websites.\n"
                    "- A *URL* is the address of a page, like `muri.app/learn`.\n"
                    "- *Search engines* help you find pages; type a clear question to get better results.\n\n"
                    "**Try it:** open a search engine and look up two topics you care about."
                ),
            },
            {
                "id": "dl-2",
                "title": "Staying safe online",
                "summary": "Passwords, scams and privacy basics everyone should know.",
                "minutes": 6,
                "content": (
                    "Safety online comes down to a few habits.\n\n"
                    "**Do**\n"
                    "- Use long, unique passwords (a passphrase like `blue-cat-runs-far`).\n"
                    "- Turn on two-factor authentication when a service offers it.\n"
                    "- Check the sender before clicking a link.\n\n"
                    "**Don't**\n"
                    "- Share one-time codes with anyone.\n"
                    "- Reuse the same password everywhere.\n\n"
                    "If something feels urgent or too good to be true, slow down and verify."
                ),
            },
            {
                "id": "dl-3",
                "title": "Using email well",
                "summary": "Write clearer emails and keep your inbox tidy.",
                "minutes": 5,
                "content": (
                    "A good email is short and specific.\n\n"
                    "1. **Subject**: say what it is about in a few words.\n"
                    "2. **Greeting**: name the person.\n"
                    "3. **Body**: one idea, one ask.\n"
                    "4. **Sign-off**: your name.\n\n"
                    "Tidy inbox tip: archive anything you have handled and unsubscribe from what you never read."
                ),
            },
        ],
    },
    {
        "id": "everyday-math",
        "title": "Everyday Math",
        "emoji": "➗",
        "category": "Everyday Skills",
        "level": "Beginner",
        "description": "Percentages, budgeting and conversions you can use straight away.",
        "lessons": [
            {
                "id": "em-1",
                "title": "Percentages made simple",
                "summary": "Discounts, tips and interest without the panic.",
                "minutes": 6,
                "content": (
                    "A percentage is a part out of 100.\n\n"
                    "**Fast tricks**\n"
                    "- 10% = move the decimal one step left (`250 → 25`).\n"
                    "- 5% = half of 10%.\n"
                    "- 20% off = pay 80% of the price.\n\n"
                    "**Example:** a ₱250 item at 20% off costs `250 × 0.8 = ₱200`."
                ),
            },
            {
                "id": "em-2",
                "title": "Building a budget",
                "summary": "Track money in, money out, and a little saved.",
                "minutes": 6,
                "content": (
                    "A budget is a plan, not a punishment.\n\n"
                    "**Simple 50 / 30 / 20 split**\n"
                    "- 50% needs (food, rent, transport)\n"
                    "- 30% wants (fun, extras)\n"
                    "- 20% savings or debt payoff\n\n"
                    "Write down last month's spending, then compare it to the split."
                ),
            },
            {
                "id": "em-3",
                "title": "Unit conversions",
                "summary": "Convert lengths, weights and temperatures with confidence.",
                "minutes": 5,
                "content": (
                    "Conversions are just multiplying by the right factor.\n\n"
                    "**Handy ones**\n"
                    "- 1 km = 1000 m\n"
                    "- 1 kg = 1000 g\n"
                    "- Celsius → Fahrenheit: `°F = °C × 9/5 + 32`\n\n"
                    "**Check:** 25°C is `25 × 9/5 + 32 = 77°F`."
                ),
            },
        ],
    },
    {
        "id": "study-skills",
        "title": "Study Skills",
        "emoji": "📚",
        "category": "Learning How to Learn",
        "level": "Intermediate",
        "description": "Learn faster and remember more with proven techniques.",
        "lessons": [
            {
                "id": "ss-1",
                "title": "Setting goals that stick",
                "summary": "Turn vague wishes into a plan you can follow.",
                "minutes": 5,
                "content": (
                    "Use the SMART checklist for a goal:\n\n"
                    "- **S**pecific, **M**easurable, **A**chievable, **R**elevant, **T**ime-bound.\n\n"
                    "Vague: *\"I want to learn math.\"*\n"
                    "SMART: *\"I will finish one Everyday Math lesson each day this week.\"*\n\n"
                    "Small daily targets beat big rare ones."
                ),
            },
            {
                "id": "ss-2",
                "title": "Active recall",
                "summary": "The single most effective study habit.",
                "minutes": 6,
                "content": (
                    "Testing yourself beats re-reading.\n\n"
                    "**How to do it**\n"
                    "1. Close the book.\n"
                    "2. Write everything you remember on a blank page.\n"
                    "3. Open the book and fix the gaps.\n"
                    "4. Repeat tomorrow (spaced repetition).\n\n"
                    "Ask Muri to quiz you on any topic to practise."
                ),
            },
            {
                "id": "ss-3",
                "title": "Notes that help",
                "summary": "Capture ideas in your own words.",
                "minutes": 5,
                "content": (
                    "Good notes are short and in your own words.\n\n"
                    "**Method**\n"
                    "- One idea per line.\n"
                    "- Add a question in the margin.\n"
                    "- Summarise the page in three sentences.\n\n"
                    "Use the **Notes** tab to keep highlights from your chats in one place."
                ),
            },
        ],
    },
    {
        "id": "english-essentials",
        "title": "English Essentials",
        "emoji": "🔤",
        "category": "Communication",
        "level": "Beginner",
        "description": "Build vocabulary and write clear, confident English.",
        "lessons": [
            {
                "id": "ee-1",
                "title": "Growing your vocabulary",
                "summary": "Learn words so they actually stay with you.",
                "minutes": 5,
                "content": (
                    "Learn words in context, not lists.\n\n"
                    "**Technique**\n"
                    "- Pick 5 new words a day from something you already read.\n"
                    "- Write a sentence with each one.\n"
                    "- Use them in a message to Muri.\n\n"
                    "Review after 1 day, 3 days and 1 week."
                ),
            },
            {
                "id": "ee-2",
                "title": "Grammar you really need",
                "summary": "Tenses and agreement, minus the jargon.",
                "minutes": 6,
                "content": (
                    "Most everyday sentences need three things right:\n\n"
                    "- **Subject–verb agreement**: *she runs* (not *she run*).\n"
                    "- **Simple tenses**: past (*ran*), present (*runs*), future (*will run*).\n"
                    "- **Articles**: *a* for one of many, *the* for a specific one.\n\n"
                    "Read your sentence aloud — if it sounds off, it usually is."
                ),
            },
            {
                "id": "ee-3",
                "title": "Writing clear messages",
                "summary": "Say what you mean in as few words as possible.",
                "minutes": 5,
                "content": (
                    "Clear writing follows one rule: one idea per sentence.\n\n"
                    "**Before:** *\"I was just wondering if maybe you could possibly help me with this thing.\"*\n"
                    "**After:** *\"Could you help me with this?\"*\n\n"
                    "Ask Muri to rewrite any message more clearly."
                ),
            },
        ],
    },
]


# --------------------------------------------------------------------------- #
# Mini-game quiz bank
# --------------------------------------------------------------------------- #
QUIZ_BANK: List[dict] = [
    {
        "id": "q1",
        "course_id": "everyday-math",
        "question": "A ₱200 item is 25% off. What do you pay?",
        "options": ["₱150", "₱175", "₱160", "₱125"],
        "answer": 0,
        "explanation": "25% off means paying 75%: 200 × 0.75 = ₱150.",
    },
    {
        "id": "q2",
        "course_id": "everyday-math",
        "question": "Which bill takes the biggest share in a 50/30/20 budget?",
        "options": ["Wants", "Savings", "Needs", "Extras"],
        "answer": 2,
        "explanation": "Needs get 50% — the largest share.",
    },
    {
        "id": "q3",
        "course_id": "digital-literacy",
        "question": "Which is the safest password habit?",
        "options": [
            "Reuse one strong password",
            "Use a long unique passphrase",
            "Use your birthday",
            "Share it with a friend",
        ],
        "answer": 1,
        "explanation": "Long, unique passphrases are hard to guess and safer when reused nowhere.",
    },
    {
        "id": "q4",
        "course_id": "digital-literacy",
        "question": "What does a URL identify?",
        "options": [
            "The speed of your Wi-Fi",
            "The address of a web page",
            "Your email password",
            "A type of file",
        ],
        "answer": 1,
        "explanation": "A URL is the address of a resource on the web.",
    },
    {
        "id": "q5",
        "course_id": "study-skills",
        "question": "Which study method is most effective?",
        "options": [
            "Re-reading the chapter",
            "Highlighting everything",
            "Active recall and testing",
            "Copying notes word for word",
        ],
        "answer": 2,
        "explanation": "Testing yourself (active recall) beats passive re-reading.",
    },
    {
        "id": "q6",
        "course_id": "study-skills",
        "question": "A SMART goal must be…",
        "options": [
            "Vague and flexible",
            "Specific and time-bound",
            "As large as possible",
            "Only about studying",
        ],
        "answer": 1,
        "explanation": "SMART goals are specific, measurable and time-bound.",
    },
    {
        "id": "q7",
        "course_id": "english-essentials",
        "question": "Choose the correct sentence.",
        "options": [
            "She run every day.",
            "She runs every day.",
            "She running every day.",
            "She runned every day.",
        ],
        "answer": 1,
        "explanation": "With 'she', the present tense verb is 'runs'.",
    },
    {
        "id": "q8",
        "course_id": "english-essentials",
        "question": "Which sentence is clearest?",
        "options": [
            "Could you help me with this?",
            "I was just wondering if maybe you could help with this thing?",
            "It would be appreciated if assistance could maybe be given.",
            "Help?",
        ],
        "answer": 0,
        "explanation": "Short and direct wins for clarity.",
    },
]


# --------------------------------------------------------------------------- #
# Request models
# --------------------------------------------------------------------------- #
class OnboardingRequest(BaseModel):
    goal: str = Field(min_length=1, max_length=200)
    level: str = Field(default="Beginner", max_length=32)
    daily_minutes: int = Field(default=10, ge=1, le=240)


class NoteCreate(BaseModel):
    title: str = Field(default="", max_length=160)
    content: str = Field(default="", max_length=20000)
    tags: Optional[str] = Field(default=None, max_length=255)
    session_id: Optional[str] = Field(default=None, max_length=64)


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=160)
    content: Optional[str] = Field(default=None, max_length=20000)
    tags: Optional[str] = Field(default=None, max_length=255)
    pinned: Optional[bool] = None


class GameScoreRequest(BaseModel):
    game: str = Field(default="quick_quiz", max_length=32)
    score: int = Field(default=0, ge=0, le=200)
    total: int = Field(default=0, ge=0, le=200)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _today():
    return datetime.now(timezone.utc).date()


def _get_stat(db, user_id: str) -> UserStat:
    stat = db.get(UserStat, user_id)
    if stat is None:
        stat = UserStat(user_id=user_id)
        db.add(stat)
        db.commit()
    return stat


def touch_activity(db, user_id: str, points: int = 0) -> UserStat:
    """Update the daily streak and award points for any learning activity."""
    stat = _get_stat(db, user_id)
    today = _today()
    last = stat.last_active_date
    if last != today:
        if last is not None and (today - last).days == 1:
            stat.current_streak += 1
        else:
            stat.current_streak = 1
        stat.last_active_date = today
        stat.longest_streak = max(stat.longest_streak, stat.current_streak)
    if points:
        stat.points += points
    db.commit()
    return stat


def _metrics(db, user_id: str) -> dict:
    from models import ChatSession, Message

    stat = db.get(UserStat, user_id)
    messages = (
        db.scalar(
            select(func.count())
            .select_from(Message)
            .join(ChatSession, Message.session_id == ChatSession.id)
            .where(ChatSession.user_id == user_id, Message.role == "user")
        )
        or 0
    )
    notes = (
        db.scalar(
            select(func.count()).select_from(Note).where(Note.user_id == user_id)
        )
        or 0
    )
    lessons = (
        db.scalar(
            select(func.count())
            .select_from(LessonProgress)
            .where(LessonProgress.user_id == user_id)
        )
        or 0
    )
    courses = (
        db.scalar(
            select(func.count())
            .select_from(Certificate)
            .where(Certificate.user_id == user_id)
        )
        or 0
    )
    games = (
        db.scalar(
            select(func.count())
            .select_from(GameScore)
            .where(GameScore.user_id == user_id)
        )
        or 0
    )
    perfect = (
        db.scalar(
            select(func.count())
            .select_from(GameScore)
            .where(
                GameScore.user_id == user_id,
                GameScore.total > 0,
                GameScore.score == GameScore.total,
            )
        )
        or 0
    )
    return {
        "messages": messages,
        "notes": notes,
        "lessons": lessons,
        "courses": courses,
        "games": games,
        "perfect": perfect,
        "points": stat.points if stat else 0,
        "current_streak": stat.current_streak if stat else 0,
        "longest_streak": stat.longest_streak if stat else 0,
    }


def evaluate_badges(db, user_id: str) -> List[dict]:
    """Award any newly earned badges and return their definitions."""
    metrics = _metrics(db, user_id)
    earned = set(
        db.scalars(
            select(BadgeAward.badge_id).where(BadgeAward.user_id == user_id)
        ).all()
    )
    newly: List[dict] = []
    for badge in BADGES:
        if badge["id"] in earned:
            continue
        if badge["check"](metrics):
            db.add(BadgeAward(user_id=user_id, badge_id=badge["id"]))
            newly.append(
                {
                    "id": badge["id"],
                    "title": badge["title"],
                    "description": badge["description"],
                    "icon": badge["icon"],
                }
            )
    if newly:
        db.commit()
    return newly


def _earned_badges(db, user_id: str) -> List[dict]:
    rows = db.execute(
        select(BadgeAward.badge_id, BadgeAward.awarded_at)
        .where(BadgeAward.user_id == user_id)
        .order_by(BadgeAward.awarded_at)
    ).all()
    result = []
    for badge_id, awarded_at in rows:
        badge = _BADGE_BY_ID.get(badge_id)
        if badge is None:
            continue
        result.append(
            {
                "id": badge["id"],
                "title": badge["title"],
                "description": badge["description"],
                "icon": badge["icon"],
                "awarded_at": _iso(awarded_at),
            }
        )
    return result


def _course_progress(db, user_id: str) -> dict:
    courses = db.scalars(select(Course).order_by(Course.order_index)).all()
    completed = set(
        db.scalars(
            select(LessonProgress.lesson_id).where(
                LessonProgress.user_id == user_id
            )
        ).all()
    )
    certs = set(
        db.scalars(
            select(Certificate.course_id).where(Certificate.user_id == user_id)
        ).all()
    )
    out = []
    for course in courses:
        lesson_ids = [lesson.id for lesson in course.lessons]
        done = sum(1 for lid in lesson_ids if lid in completed)
        total = len(lesson_ids)
        out.append(
            {
                "id": course.id,
                "title": course.title,
                "description": course.description,
                "emoji": course.emoji,
                "category": course.category,
                "level": course.level,
                "lesson_count": total,
                "completed_count": done,
                "progress": round(done / total * 100) if total else 0,
                "certificate": course.id in certs,
                "lessons": [
                    {
                        "id": lesson.id,
                        "title": lesson.title,
                        "summary": lesson.summary,
                        "minutes": lesson.minutes,
                        "completed": lesson.id in completed,
                    }
                    for lesson in course.lessons
                ],
            }
        )
    return {"courses": out}


def seed_courses() -> None:
    """Insert the built-in course catalog once (idempotent)."""
    with SessionLocal() as db:
        for index, spec in enumerate(COURSE_SEED):
            if db.get(Course, spec["id"]) is not None:
                continue
            course = Course(
                id=spec["id"],
                title=spec["title"],
                description=spec["description"],
                emoji=spec["emoji"],
                category=spec["category"],
                level=spec["level"],
                order_index=index,
            )
            db.add(course)
            for lesson_index, lesson in enumerate(spec["lessons"]):
                db.add(
                    Lesson(
                        id=lesson["id"],
                        course_id=spec["id"],
                        title=lesson["title"],
                        summary=lesson["summary"],
                        content=lesson["content"],
                        minutes=lesson["minutes"],
                        order_index=lesson_index,
                    )
                )
        db.commit()


# --------------------------------------------------------------------------- #
# Endpoints — profile & onboarding
# --------------------------------------------------------------------------- #
@router.get("/api/learn/profile")
def learn_profile(user: User = Depends(require_user)) -> dict:
    with SessionLocal() as db:
        stat = db.get(UserStat, user.id)
        settings = read_user_settings(db, user.id, CATALOG_DEFAULTS)
        metrics = _metrics(db, user.id)
        certificates = (
            db.scalar(
                select(func.count())
                .select_from(Certificate)
                .where(Certificate.user_id == user.id)
            )
            or 0
        )
        notes_count = metrics["notes"]
        today = _today()
        last = stat.last_active_date if stat else None
    return {
        "onboarded": settings.get("onboarded") == "1",
        "goal": settings.get("goal") or None,
        "level": settings.get("level") or "Beginner",
        "daily_minutes": int(settings.get("daily_minutes") or 10),
        "points": metrics["points"],
        "streak": {
            "current": metrics["current_streak"],
            "longest": metrics["longest_streak"],
            "active_today": last == today,
            "last_active": _iso(
                datetime.combine(last, datetime.min.time()) if last else None
            ),
        },
        "counts": {
            "notes": notes_count,
            "lessons": metrics["lessons"],
            "courses": metrics["courses"],
            "games": metrics["games"],
            "messages": metrics["messages"],
        },
        "certificates": certificates,
        "badges": {
            "earned": _earned_badges(db, user.id),
            "catalog": badge_catalog(),
        },
    }


@router.post("/api/learn/onboarding")
def complete_onboarding(
    req: OnboardingRequest, user: User = Depends(require_user)
) -> dict:
    with SessionLocal() as db:
        write_user_settings(
            db,
            user.id,
            {
                "goal": req.goal.strip(),
                "level": req.level.strip() or "Beginner",
                "daily_minutes": str(req.daily_minutes),
                "onboarded": "1",
            },
        )
        touch_activity(db, user.id, points=5)
        new_badges = evaluate_badges(db, user.id)
        stat = db.get(UserStat, user.id)
    return {
        "status": "ok",
        "points": stat.points if stat else 0,
        "new_badges": new_badges,
    }


@router.get("/api/learn/badges")
def list_badges(user: User = Depends(require_user)) -> dict:
    with SessionLocal() as db:
        return {
            "earned": _earned_badges(db, user.id),
            "catalog": badge_catalog(),
        }


# --------------------------------------------------------------------------- #
# Endpoints — courses & lessons
# --------------------------------------------------------------------------- #
@router.get("/api/learn/courses")
def list_courses(user: User = Depends(require_user)) -> dict:
    with SessionLocal() as db:
        return _course_progress(db, user.id)


@router.get("/api/learn/courses/{course_id}")
def course_detail(course_id: str, user: User = Depends(require_user)) -> dict:
    with SessionLocal() as db:
        course = db.get(Course, course_id)
        if course is None:
            raise HTTPException(status_code=404, detail="Course not found")
        completed = set(
            db.scalars(
                select(LessonProgress.lesson_id).where(
                    LessonProgress.user_id == user.id
                )
            ).all()
        )
        certificate = db.scalar(
            select(Certificate).where(
                Certificate.user_id == user.id,
                Certificate.course_id == course_id,
            )
        )
        lessons = [
            {
                "id": lesson.id,
                "title": lesson.title,
                "summary": lesson.summary,
                "content": lesson.content,
                "minutes": lesson.minutes,
                "completed": lesson.id in completed,
            }
            for lesson in course.lessons
        ]
        done = sum(1 for lesson in lessons if lesson["completed"])
        total = len(lessons)
        return {
            "id": course.id,
            "title": course.title,
            "description": course.description,
            "emoji": course.emoji,
            "category": course.category,
            "level": course.level,
            "completed_count": done,
            "lesson_count": total,
            "progress": round(done / total * 100) if total else 0,
            "certificate": certificate is not None,
            "certificate_id": certificate.id if certificate else None,
            "lessons": lessons,
        }


@router.post("/api/learn/lessons/{lesson_id}/complete")
def complete_lesson(lesson_id: str, user: User = Depends(require_user)) -> dict:
    with SessionLocal() as db:
        lesson = db.get(Lesson, lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Lesson not found")
        existing = db.scalar(
            select(LessonProgress).where(
                LessonProgress.user_id == user.id,
                LessonProgress.lesson_id == lesson_id,
            )
        )
        first_time = existing is None
        if first_time:
            db.add(LessonProgress(user_id=user.id, lesson_id=lesson_id))
            db.commit()

        certificate = None
        course = db.get(Course, lesson.course_id)
        if course is not None:
            lesson_ids = [item.id for item in course.lessons]
            completed = set(
                db.scalars(
                    select(LessonProgress.lesson_id).where(
                        LessonProgress.user_id == user.id,
                        LessonProgress.lesson_id.in_(lesson_ids),
                    )
                ).all()
            )
            if lesson_ids and all(lid in completed for lid in lesson_ids):
                cert = db.scalar(
                    select(Certificate).where(
                        Certificate.user_id == user.id,
                        Certificate.course_id == course.id,
                    )
                )
                if cert is None:
                    cert = Certificate(
                        id=str(uuid.uuid4()),
                        user_id=user.id,
                        course_id=course.id,
                    )
                    db.add(cert)
                    db.commit()
                    certificate = {
                        "id": cert.id,
                        "course_id": course.id,
                        "course_title": course.title,
                        "issued_at": _iso(cert.issued_at),
                    }

        if first_time:
            stat = touch_activity(db, user.id, points=10)
        else:
            stat = db.get(UserStat, user.id) or touch_activity(db, user.id)
        new_badges = evaluate_badges(db, user.id)
        stat = db.get(UserStat, user.id)

    return {
        "status": "ok",
        "first_time": first_time,
        "points": stat.points if stat else 0,
        "streak": stat.current_streak if stat else 0,
        "new_badges": new_badges,
        "certificate": certificate,
    }


# --------------------------------------------------------------------------- #
# Endpoints — certificates
# --------------------------------------------------------------------------- #
@router.get("/api/learn/certificates")
def list_certificates(user: User = Depends(require_user)) -> dict:
    with SessionLocal() as db:
        rows = db.scalars(
            select(Certificate)
            .where(Certificate.user_id == user.id)
            .order_by(Certificate.issued_at.desc())
        ).all()
        out = []
        for cert in rows:
            course = db.get(Course, cert.course_id)
            out.append(
                {
                    "id": cert.id,
                    "course_id": cert.course_id,
                    "course_title": course.title if course else cert.course_id,
                    "emoji": course.emoji if course else "🎓",
                    "level": course.level if course else "",
                    "issued_at": _iso(cert.issued_at),
                }
            )
        return {"certificates": out}


# --------------------------------------------------------------------------- #
# Endpoints — games
# --------------------------------------------------------------------------- #
@router.get("/api/learn/game/quiz")
def game_quiz(
    course_id: Optional[str] = None, user: User = Depends(require_user)
) -> dict:
    bank = [
        q for q in QUIZ_BANK if course_id is None or q["course_id"] == course_id
    ]
    if not bank:
        bank = QUIZ_BANK
    questions = [
        {
            "id": q["id"],
            "course_id": q["course_id"],
            "question": q["question"],
            "options": q["options"],
            "answer": q["answer"],
            "explanation": q["explanation"],
        }
        for q in bank
    ]
    return {"questions": questions}


@router.post("/api/learn/game/score")
def submit_score(
    req: GameScoreRequest, user: User = Depends(require_user)
) -> dict:
    # Points feed badges/streaks: a forged score must never mint points.
    if req.score > req.total:
        raise HTTPException(
            status_code=400, detail="Score cannot exceed the total."
        )
    with SessionLocal() as db:
        db.add(
            GameScore(
                user_id=user.id,
                game=req.game,
                score=req.score,
                total=req.total,
            )
        )
        db.commit()
        touch_activity(db, user.id, points=max(req.score, 1))
        new_badges = evaluate_badges(db, user.id)
        stat = db.get(UserStat, user.id)
    return {
        "status": "ok",
        "points": stat.points if stat else 0,
        "new_badges": new_badges,
    }


# --------------------------------------------------------------------------- #
# Endpoints — notes
# --------------------------------------------------------------------------- #
def _note_public(note: Note) -> dict:
    return {
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "tags": note.tags,
        "pinned": bool(note.pinned),
        "session_id": note.session_id,
        "created_at": _iso(note.created_at),
        "updated_at": _iso(note.updated_at),
    }


@router.get("/api/notes")
def list_notes(
    q: Optional[str] = None, user: User = Depends(require_user)
) -> dict:
    with SessionLocal() as db:
        rows = db.scalars(
            select(Note)
            .where(Note.user_id == user.id)
            .order_by(Note.pinned.desc(), Note.updated_at.desc())
        ).all()
        if q and q.strip():
            needle = q.strip().lower()
            rows = [
                note
                for note in rows
                if needle in (note.title or "").lower()
                or needle in (note.content or "").lower()
                or needle in (note.tags or "").lower()
            ]
        return {"notes": [_note_public(note) for note in rows]}


@router.post("/api/notes")
def create_note(req: NoteCreate, user: User = Depends(require_user)) -> dict:
    with SessionLocal() as db:
        title = req.title.strip()
        content = req.content.strip()
        if not title and not content:
            raise HTTPException(status_code=400, detail="Note is empty.")
        # Row-level ownership: a note may only reference the caller's own chat.
        session_id = req.session_id
        if session_id:
            session = db.get(ChatSession, session_id)
            if session is None or session.user_id != user.id:
                raise HTTPException(
                    status_code=400, detail="Unknown chat session."
                )
        if not title:
            title = " ".join(content.split())[:60] or "Untitled note"
        note = Note(
            id=str(uuid.uuid4()),
            user_id=user.id,
            session_id=session_id,
            title=title,
            content=content,
            tags=(req.tags or "").strip() or None,
        )
        db.add(note)
        db.commit()
        db.refresh(note)
        touch_activity(db, user.id)
        new_badges = evaluate_badges(db, user.id)
        return {"note": _note_public(note), "new_badges": new_badges}


@router.patch("/api/notes/{note_id}")
def update_note(
    note_id: str, req: NoteUpdate, user: User = Depends(require_user)
) -> dict:
    with SessionLocal() as db:
        note = db.get(Note, note_id)
        if note is None or note.user_id != user.id:
            raise HTTPException(status_code=404, detail="Note not found")
        if req.title is not None:
            note.title = req.title.strip()[:160]
        if req.content is not None:
            note.content = req.content.strip()
        if req.tags is not None:
            note.tags = req.tags.strip() or None
        if req.pinned is not None:
            note.pinned = req.pinned
        db.commit()
        db.refresh(note)
        return {"note": _note_public(note)}


@router.delete("/api/notes/{note_id}")
def delete_note(note_id: str, user: User = Depends(require_user)) -> dict:
    with SessionLocal() as db:
        note = db.get(Note, note_id)
        if note is not None and note.user_id == user.id:
            db.delete(note)
            db.commit()
    return {"status": "ok"}
