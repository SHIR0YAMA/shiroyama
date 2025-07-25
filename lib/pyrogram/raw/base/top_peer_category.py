#  Pyrogram - Telegram MTProto API Client Library for Python
#  Copyright (C) 2017-present Dan <https://github.com/delivrance>
#
#  This file is part of Pyrogram.
#
#  Pyrogram is free software: you can redistribute it and/or modify
#  it under the terms of the GNU Lesser General Public License as published
#  by the Free Software Foundation, either version 3 of the License, or
#  (at your option) any later version.
#
#  Pyrogram is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU Lesser General Public License for more details.
#
#  You should have received a copy of the GNU Lesser General Public License
#  along with Pyrogram.  If not, see <http://www.gnu.org/licenses/>.

# # # # # # # # # # # # # # # # # # # # # # # #
#               !!! WARNING !!!               #
#          This is a generated file!          #
# All changes made in this file will be lost! #
# # # # # # # # # # # # # # # # # # # # # # # #

from typing import Union
from pyrogram import raw
from pyrogram.raw.core import TLObject

# We need to dynamically set `__doc__` due to `sphinx`
TopPeerCategory = Union[raw.types.TopPeerCategoryBotsApp, raw.types.TopPeerCategoryBotsInline, raw.types.TopPeerCategoryBotsPM, raw.types.TopPeerCategoryChannels, raw.types.TopPeerCategoryCorrespondents, raw.types.TopPeerCategoryForwardChats, raw.types.TopPeerCategoryForwardUsers, raw.types.TopPeerCategoryGroups, raw.types.TopPeerCategoryPhoneCalls]
TopPeerCategory.__doc__ = """
    Telegram API base type.

    Constructors:
        This base type has 9 constructors available.

        .. currentmodule:: pyrogram.raw.types

        .. autosummary::
            :nosignatures:

            TopPeerCategoryBotsApp
            TopPeerCategoryBotsInline
            TopPeerCategoryBotsPM
            TopPeerCategoryChannels
            TopPeerCategoryCorrespondents
            TopPeerCategoryForwardChats
            TopPeerCategoryForwardUsers
            TopPeerCategoryGroups
            TopPeerCategoryPhoneCalls
"""
