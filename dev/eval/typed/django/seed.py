# Seeds the locallibrary database with a small, fixed catalog (idempotent: wipes and recreates).
import datetime

import django

django.setup()

from catalog.models import Author, Book, BookInstance, Genre, Language  # noqa: E402

BookInstance.objects.all().delete()
Book.objects.all().delete()
Author.objects.all().delete()
Genre.objects.all().delete()
Language.objects.all().delete()

fantasy = Genre.objects.create(name="Fantasy")
scifi = Genre.objects.create(name="Science Fiction")
classic = Genre.objects.create(name="Classic")
english = Language.objects.create(name="English")
spanish = Language.objects.create(name="Spanish")

tolkien = Author.objects.create(first_name="J.R.R.", last_name="Tolkien", date_of_birth=datetime.date(1892, 1, 3), date_of_death=datetime.date(1973, 9, 2))
leguin = Author.objects.create(first_name="Ursula", last_name="Le Guin", date_of_birth=datetime.date(1929, 10, 21), date_of_death=datetime.date(2018, 1, 22))
cervantes = Author.objects.create(first_name="Miguel", last_name="de Cervantes", date_of_birth=datetime.date(1547, 9, 29), date_of_death=datetime.date(1616, 4, 22))
Author.objects.create(first_name="Ada", last_name="Newwriter", date_of_birth=datetime.date(1990, 5, 1))

hobbit = Book.objects.create(title="The Hobbit", author=tolkien, summary="Bilbo Baggins goes on an unexpected journey.", isbn="9780261102217", language=english)
hobbit.genre.set([fantasy, classic])
lotr = Book.objects.create(title="The Fellowship of the Ring", author=tolkien, summary="The first part of The Lord of the Rings.", isbn="9780261102354", language=english)
lotr.genre.set([fantasy])
earthsea = Book.objects.create(title="A Wizard of Earthsea", author=leguin, summary="A young mage learns the cost of power.", isbn="9780547773742", language=english)
earthsea.genre.set([fantasy])
dispossessed = Book.objects.create(title="The Dispossessed", author=leguin, summary="An anarchist physicist crosses between two worlds.", isbn="9780061054884", language=english)
dispossessed.genre.set([scifi])
quijote = Book.objects.create(title="Don Quijote de la Mancha", author=cervantes, summary="An aging nobleman sets out as a knight-errant.", isbn="9788420412146", language=spanish)
quijote.genre.set([classic])

today = datetime.date(2026, 9, 28)
copies = [
    (hobbit, "Allen & Unwin, 1937", "a", None),
    (hobbit, "HarperCollins, 1995", "o", today + datetime.timedelta(days=12)),
    (hobbit, "Del Rey, 2012", "m", None),
    (lotr, "HarperCollins, 2005", "a", None),
    (lotr, "Mariner Books, 2012", "o", today + datetime.timedelta(days=5)),
    (earthsea, "Parnassus Press, 1968", "a", None),
    (dispossessed, "Harper & Row, 1974", "r", None),
    (quijote, "Real Academia Espanola, 2015", "a", None),
    (quijote, "Catedra, 2004", "o", today + datetime.timedelta(days=20)),
]
for book, imprint, status, due in copies:
    BookInstance.objects.create(book=book, imprint=imprint, status=status, due_back=due)

print("seeded", Book.objects.count(), "books", BookInstance.objects.count(), "copies", Author.objects.count(), "authors; hobbit id", hobbit.id)
