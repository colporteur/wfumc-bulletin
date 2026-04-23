export default function WelcomeCalendarSection({ bulletin }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Welcome &amp; Calendar</h2>
        <p className="text-sm text-gray-600 mt-1">
          Welcome blurb, this week's calendar, the Each Week schedule, and
          birthdays for the current month.
        </p>
      </div>

      <div className="card text-center text-gray-500">
        <p className="text-sm">Editor coming in a future build session.</p>
        <p className="text-xs mt-2">
          For now, the worshipper view will use the church-wide defaults from
          Settings.
        </p>
      </div>
    </div>
  );
}
